import { getAnkiImage, getRandomQuestions, imageInputSchema, randomQuestionsSchema, rateQuestion, rateQuestionSchema } from '@/lib/anki'
import { createMcpHandler } from 'mcp-handler'

const handler = createMcpHandler((server) => {
    server.registerTool(
        'get_random_questions',
        {
            description:
                'Get 1–10 random Anki cards rated on the website and due for review now with stable IDs, categories ordered from broad to specific, question and answer text, and optional imageIds on each side. Image data is not included; call get_anki_image only when an image is needed. Cards do not repeat within a call; pass excludeCardIds to avoid earlier cards. When quizzing, show only the question and any needed question images until the learner answers. Answer images may reveal the solution. Each returned batch is saved as a session for 72 hours; keep its sessionId to record the learner’s rating with rate_question.',
            inputSchema: randomQuestionsSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
        },
        getRandomQuestions
    )
    server.registerTool(
        'rate_question',
        {
            description:
                'Save the learner’s own rating for a question from a recent MCP session. Ask which rating they choose; do not infer or grade it for them. Again schedules 1 minute, Hard 6 minutes, Good 10 minutes, Easy 10 days. Uses the same schedule as the website. A question can be rated once per session; retries return the saved result without rescheduling. A newer review cannot be overwritten before the question is due. Sessions expire after 72 hours.',
            inputSchema: rateQuestionSchema,
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        },
        rateQuestion
    )
    server.registerTool(
        'get_anki_image',
        {
            description:
                'Get an original Anki image from a currently approved, due card on demand using an ID from question.imageIds or answer.imageIds returned by get_random_questions.',
            inputSchema: imageInputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        },
        getAnkiImage
    )
})

export { handler as GET, handler as POST }
