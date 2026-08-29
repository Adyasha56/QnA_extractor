import { AssessmentResult } from "../models/assessment";
import * as assessmentService from "./assessmentService";
import { processDocument } from "../clients/pythonClient";
import { extractQuestions } from "./questionExtractor";
import { extractAnswers } from "./answerExtractor";
import { localizeAnswerRegions } from "./answerLocalizationService";
import { mapQuestionsToAnswers } from "./mappingService";
import { gradeAnswers } from "./gradingService";
import { buildVisionClientFromEnv } from "../clients/visionClientFactory";
import { isAiUnavailableError } from "../clients/geminiVisionClient";
import { QuestionGrading } from "../models/grading";

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
  const warnings: string[] = [];

  // Clear any error from a previous failed run of this same assessment.
  assessmentService.setError(id, undefined);

  try {
    assessmentService.updateStatus(id, "processing_question_paper");
    const questionPages = await processDocument(assessment.questionPaper.secureUrl);
    const questions = await extractQuestions(questionPages, {
      visionProvider,
      imageUrl: assessment.questionPaper.secureUrl,
      // Photographed/scanned images are far less reliable for OCR than a
      // clean PDF render, so prefer AI extraction in that case.
      preferAI: assessment.questionPaper.format !== "pdf",
    });

    assessmentService.updateStatus(id, "processing_answer_sheet");
    const answerPages = await processDocument(assessment.answerSheet.secureUrl);
    let answers = await extractAnswers(answerPages, {
      visionProvider,
      imageUrl: assessment.answerSheet.secureUrl,
    });

    // Best-effort: a localization failure never crashes the pipeline — the
    // result just keeps text-only answers with empty regions instead.
    if (visionProvider) {
      try {
        const isPdf = assessment.answerSheet.format === "pdf";
        answers = await localizeAnswerRegions(
          assessment.answerSheet.secureUrl,
          answers,
          visionProvider,
          isPdf
            ? { isPdf: true }
            : {
                isPdf: false,
                imageWidth: answerPages[0]?.width ?? 0,
                imageHeight: answerPages[0]?.height ?? 0,
              }
        );
      } catch (err) {
        console.error(
          `[localizeAnswerRegions] failed for assessment ${id}:`,
          err instanceof Error ? err.message : err
        );
        warnings.push(
          isAiUnavailableError(err)
            ? "AI service was temporarily rate-limited or overloaded. Try again after some time."
            : "Exact answer-region highlighting could not be computed for this answer sheet."
        );
      }
    }

    assessmentService.updateStatus(id, "mapping_answers");
    const { mappings, unanswered, unmatched } = await mapQuestionsToAnswers(
      questions,
      answers
    );

    // Best-effort: a grading failure must never fail the pipeline.
    let grading: QuestionGrading[] = [];
    try {
      grading = await gradeAnswers(questions, answers, mappings);
    } catch (err) {
      warnings.push(
        isAiUnavailableError(err)
          ? "AI service was temporarily rate-limited or overloaded. Try again after some time."
          : "AI grading and feedback could not be generated for this assessment."
      );
    }

    const result: AssessmentResult = {
      assessmentId: id,
      questions,
      answers,
      mappings,
      unansweredQuestions: unanswered,
      unmatchedAnswers: unmatched,
      processingStatus: "completed",
      ...(grading.length > 0 ? { grading } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    assessmentService.setResult(id, result);
    assessmentService.updateStatus(id, "completed");

    return result;
  } catch (err) {
    assessmentService.updateStatus(id, "failed");
    assessmentService.setError(id, {
      message: isAiUnavailableError(err)
        ? "AI service was temporarily rate-limited or overloaded. Try again after some time."
        : err instanceof Error
          ? err.message
          : "Processing failed unexpectedly.",
      code: isAiUnavailableError(err) ? "ai_unavailable" : "unknown",
    });
    throw err;
  }
}
