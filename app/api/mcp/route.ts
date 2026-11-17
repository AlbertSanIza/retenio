import { getAnkiImage, getRandomQuestions, imageInputSchema, randomQuestionsSchema } from '@/lib/anki'
import { createMcpHandler } from 'mcp-handler'

const handler = createMcpHandler((server) => {
    server.registerTool(
        'get_random_questions',
        {
            description:
                'Get random Anki cards with questions, answers, deck names, tags and images. Cards do not repeat within a call; pass excludeCardIds to avoid earlier cards. When quizzing, show only the question and its images until the learner answers. Answer images may reveal the solution. Fetch any deferredImageIds with get_anki_image.',
            inputSchema: randomQuestionsSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        },
        getRandomQuestions
    )
    server.registerTool(
        'get_anki_image',
        {
            description: 'Get an original Anki image by its image ID, including images deferred from a large get_random_questions response.',
            inputSchema: imageInputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        },
        getAnkiImage
    )
})

export { handler as GET, handler as POST }
