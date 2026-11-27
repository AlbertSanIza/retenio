import Foundation
import zlib

/// Bounded reader for classic ZIP32 Anki exports. No archive paths are extracted.
nonisolated struct AnkiArchive {
    private struct Entry {
        let method: Int
        let crc: UInt32
        let compressed: Int
        let size: Int
        let offset: Int
    }
    private let bytes: Data
    private var directoryOffset = 0
    private var entries: [String: Entry] = [:]
    var names: Set<String> { Set(entries.keys) }

    init(url: URL) throws {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 128 * 1024 * 1024 else {
            throw LibraryError.invalid("Please import an Anki package smaller than 128 MB.")
        }
        bytes = try Data(contentsOf: url, options: .mappedIfSafe)
        guard bytes.count >= 22, bytes.count <= 128 * 1024 * 1024 else { throw LibraryError.invalid("This isn't a valid Anki package.") }
        var end: Int?
        for position in stride(from: bytes.count - 22, through: max(0, bytes.count - 65557), by: -1) {
            if try number(position, 4) == 0x0605_4b50, position + 22 + (try number(position + 20, 2)) == bytes.count {
                end = position
                break
            }
        }
        guard let end, try number(end + 4, 2) == 0, try number(end + 6, 2) == 0 else {
            throw LibraryError.invalid("Split ZIP archives are not supported.")
        }
        let count = try number(end + 10, 2)
        guard count > 0, count < 60000, try number(end + 8, 2) == count else {
            throw LibraryError.invalid("The package has too many entries.")
        }
        var cursor = try number(end + 16, 4)
        directoryOffset = cursor
        let centralEnd = cursor + (try number(end + 12, 4))
        guard centralEnd <= end else { throw LibraryError.invalid("Invalid archive directory.") }
        for _ in 0..<count {
            guard try number(cursor, 4) == 0x0201_4b50, try number(cursor + 8, 2) & 1 == 0 else {
                throw LibraryError.invalid("Encrypted or damaged packages aren't supported.")
            }
            let method = try number(cursor + 10, 2)
            let nameLength = try number(cursor + 28, 2)
            let next = cursor + 46 + nameLength + (try number(cursor + 30, 2)) + (try number(cursor + 32, 2))
            guard next <= centralEnd, let name = String(data: try slice(cursor + 46, nameLength), encoding: .utf8),
                entries[name] == nil
            else { throw LibraryError.invalid("Invalid or duplicate archive entry.") }
            entries[name] = Entry(
                method: method, crc: UInt32(try number(cursor + 16, 4)), compressed: try number(cursor + 20, 4),
                size: try number(cursor + 24, 4), offset: try number(cursor + 42, 4), )
            cursor = next
        }
        guard cursor == centralEnd else { throw LibraryError.invalid("Invalid archive directory length.") }
    }

    func read(_ name: String, limit: Int) throws -> Data {
        guard let entry = entries[name], entry.size <= limit, entry.compressed <= bytes.count,
            try number(entry.offset, 4) == 0x0403_4b50
        else { throw LibraryError.invalid("A required package file is missing or too large: \(name)") }
        let start = entry.offset + 30 + (try number(entry.offset + 26, 2)) + (try number(entry.offset + 28, 2))
        guard start <= directoryOffset, entry.compressed <= directoryOffset - start,
            entry.method != 0 || entry.compressed == entry.size
        else {
            throw LibraryError.invalid("Stored entry has inconsistent sizes.")
        }
        var input = try slice(start, entry.compressed)
        let output: Data
        if entry.method == 0 {
            output = input
        } else if entry.method == 8 {
            var result = Data(count: max(1, entry.size))
            var stream = z_stream()
            guard inflateInit2_(&stream, -MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
                throw LibraryError.invalid("Couldn't decompress the package.")
            }
            defer { inflateEnd(&stream) }
            let status = input.withUnsafeMutableBytes { source in
                result.withUnsafeMutableBytes { destination in
                    stream.next_in = source.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_in = uInt(entry.compressed)
                    stream.next_out = destination.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(max(1, entry.size))
                    return inflate(&stream, Z_FINISH)
                }
            }
            guard status == Z_STREAM_END, stream.total_out == entry.size, stream.total_in == entry.compressed else {
                throw LibraryError.invalid("Damaged or oversized compressed entry.")
            }
            output = result.prefix(entry.size)
        } else {
            throw LibraryError.invalid("Export from Anki with ‘Support older Anki versions’ enabled.")
        }
        let crc = output.withUnsafeBytes { crc32(0, $0.bindMemory(to: Bytef.self).baseAddress, uInt(output.count)) }
        guard output.count == entry.size, UInt32(crc) == entry.crc else {
            throw LibraryError.invalid("Package checksum failed.")
        }
        return output
    }

    private func number(_ offset: Int, _ length: Int) throws -> Int {
        let data = try slice(offset, length)
        return data.enumerated().reduce(0) { $0 | (Int($1.element) << ($1.offset * 8)) }
    }
    private func slice(_ offset: Int, _ count: Int) throws -> Data {
        guard offset >= 0, count >= 0, offset <= bytes.count, count <= bytes.count - offset else {
            throw LibraryError.invalid("Truncated archive.")
        }
        return bytes.subdata(in: offset..<(offset + count))
    }
}
