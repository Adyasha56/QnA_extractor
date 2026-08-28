import { AssessmentResult } from "../models/assessment";
import * as assessmentService from "./assessmentService";
import { processDocument } from "../clients/pythonClient";
import { extractQuestions } from "./questionExtractor";
import { extractAnswers } from "./answerExtractor";
import { localizeAnswerRegions } from "./answerLocalizationService";
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

  // Prevent concurrent processing — a second call while one is in flight
  // would cause both to run simultaneously against the same in-memory state.
  const inProgress = ["processing_question_paper", "processing_answer_sheet", "mapping_answers"];
  if (inProgress.includes(assessment.status)) {
    throw Object.assign(
      new Error("Assessment is already being processed. Please wait for it to complete."),
      { statusCode: 409 }
    );
  }

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
    let answers = await extractAnswers(answerPages, {
      visionProvider,
      imageUrl: assessment.answerSheet.secureUrl,
    });

    // Phase 8: populate Answer.regions via Gemini coarse bbox + OpenCV tightening.
    // Best-effort: a localization failure never crashes the pipeline; the result
    // will contain text-only answers with empty regions instead.
    if (visionProvider) {
      try {
        answers = await localizeAnswerRegions(
          assessment.answerSheet.secureUrl,
          answers,
          visionProvider
        );
      } catch {
        // Localization failed — continue with text-only answers.
      }
    }

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
