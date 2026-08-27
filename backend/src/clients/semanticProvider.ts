/**
 * Abstraction for semantic similarity scoring between a question and an answer.
 * Concrete implementations (e.g. embedding-based, LLM-based) plug in here.
 * Returns a normalised score in [0, 1].
 */
export interface SemanticProvider {
  score(questionText: string, answerText: string): Promise<number>;
}
