import Foundation

enum LiveSessionConfiguration {
    static var startEvent: [String: Any] {
        [
            "type": "session.start",
            "session": [
                "model": "gpt-live-1.1", "store": false,
                "instructions":
                    "You are Retenio, a warm learning companion. Keep replies short, listen naturally, and yield to interruptions. This build supports conversation only, with no tools or card access.",
                "audio": ["format": ["type": "audio/pcm", "rate": 24000], "output": ["voice": "marin"]],
                "delegation": ["type": "client"],
                "input": [
                    [
                        "type": "message", "role": "developer",
                        "content": [
                            [
                                "type": "input_text",
                                "text": "Greet the learner in one short friendly sentence and listen.",
                            ]
                        ],
                    ]
                ],
            ],
        ]
    }
}
