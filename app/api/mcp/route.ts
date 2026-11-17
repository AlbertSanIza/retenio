import { getAnkiImage, getRandomQuestions, imageInputSchema, randomQuestionsSchema } from '@/lib/anki'
import { createMcpHandler } from 'mcp-handler'

const handler = createMcpHandler((server) => {
    server.registerTool(
        'get_random_questions',
        {
            description:
                'Get 1–10 random Anki cards approved on the website after study with stable IDs, categories ordered from broad to specific, question and answer text, and optional imageIds on each side. Image data is not included; call get_anki_image only when an image is needed. Cards do not repeat within a call; pass excludeCardIds to avoid earlier cards. When quizzing, show only the question and any needed question images until the learner answers. Answer images may reveal the solution.',
            inputSchema: randomQuestionsSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        },
        getRandomQuestions
    )
    server.registerTool(
        'get_anki_image',
        {
            description:
                'Get an original Anki image from a currently approved card on demand using an ID from question.imageIds or answer.imageIds returned by get_random_questions.',
            inputSchema: imageInputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        },
        getAnkiImage
    )
})

export { handler as GET, handler as POST }
