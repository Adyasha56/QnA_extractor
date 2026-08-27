import { AssessmentResult } from "../models/assessment";
import * as assessmentService from "./assessmentService";
import { processDocument } from "../clients/pythonClient";
import { extractQuestions } from "./questionExtractor";
import { extractAnswers } from "./answerExtractor";
import { mapQuestionsToAnswers } from "./mappingService";
import { buildVisionClientFromEnv } from "../clients/visionClientFactory";

/**
 * Run the full extraction + mapping pipeline for an assessment.
 *
 * Pipeline:
 *   1. Validate assessment, question paper, and answer sheet exist.
 *   2. Send question paper URL to Python → extract questions.
 *   3. Send answer sheet URL to Python → extract answers.
 *   4. Map questions to answers (deterministic label matching only).
 *   5. Persist result on the assessment and mark it completed.
 *
 * Any failure sets the assessment status to "failed" before re-throwing,
 * so callers always observe a consistent state.
 */
export async function processAssessment(id: string): Promise<AssessmentResult> {
  // Throws 404 if not found.
  const assessment = assessmentService.getAssessment(id);

  if (!assessment.questionPaper) {
    throw Object.assign(
      new Error("Question paper has not been uploaded for this assessment"),
      { statusCode: 400 }
    );
  }

  if (!assessment.answerSheet) {
    throw Object.assign(
      new Error("Answer sheet has not been uploaded for this assessment"),
      { statusCode: 400 }
    );
  }

  const visionProvider = buildVisionClientFromEnv() ?? undefined;

  try {
    assessmentService.updateStatus(id, "processing_question_paper");
    const questionPages = await processDocument(assessment.questionPaper.secureUrl);
    const questions = await extractQuestions(questionPages, {
      visionProvider,
      imageUrl: assessment.questionPaper.secureUrl,
    });

    assessmentService.updateStatus(id, "processing_answer_sheet");
    const answerPages = await processDocument(assessment.answerSheet.secureUrl);
    const answers = await extractAnswers(answerPages, {
      visionProvider,
      imageUrl: assessment.answerSheet.secureUrl,
    });

    assessmentService.updateStatus(id, "mapping_answers");
    const { mappings, unanswered, unmatched } = await mapQuestionsToAnswers(
      questions,
      answers
    );

    const result: AssessmentResult = {
      assessmentId: id,
      questions,
      answers,
      mappings,
      unansweredQuestions: unanswered,
      unmatchedAnswers: unmatched,
      processingStatus: "completed",
    };

    assessmentService.setResult(id, result);
    assessmentService.updateStatus(id, "completed");

    return result;
  } catch (err) {
    assessmentService.updateStatus(id, "failed");
    throw err;
  }
}
