import request from "supertest";
import app from "../src/app";
import { _clearStore } from "../src/services/assessmentService";
import { CloudinaryAsset } from "../src/models/assessment";

// Mock the Cloudinary client so tests never hit the real service.
jest.mock("../src/clients/cloudinaryClient");
import { uploadToCloudinary } from "../src/clients/cloudinaryClient";

const mockUpload = uploadToCloudinary as jest.MockedFunction<typeof uploadToCloudinary>;

const FAKE_ASSET: CloudinaryAsset = {
  publicId: "question-papers/test-id/file",
  secureUrl: "https://res.cloudinary.com/demo/image/upload/test.pdf",
  resourceType: "raw",
  format: "pdf",
  originalFilename: "paper.pdf",
};

const PDF_BUFFER = Buffer.from("%PDF-1.4 fake pdf content");

beforeEach(() => {
  _clearStore();
  mockUpload.mockResolvedValue(FAKE_ASSET);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Assessment creation ────────────────────────────────────────────────────

describe("POST /api/assessments", () => {
  it("creates a new assessment and returns 201", async () => {
    const res = await request(app).post("/api/assessments");
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("string");
    expect(res.body.status).toBe("idle");
    expect(typeof res.body.createdAt).toBe("string");
    expect(typeof res.body.updatedAt).toBe("string");
    expect(res.body.questionPaper).toBeUndefined();
    expect(res.body.answerSheet).toBeUndefined();
  });

  it("generates a unique ID for each assessment", async () => {
    const [a, b] = await Promise.all([
      request(app).post("/api/assessments"),
      request(app).post("/api/assessments"),
    ]);
    expect(a.body.id).not.toBe(b.body.id);
  });
});

// ─── Assessment retrieval ───────────────────────────────────────────────────

describe("GET /api/assessments/:id", () => {
  it("returns the assessment when it exists", async () => {
    const created = await request(app).post("/api/assessments");
    const { id } = created.body;

    const res = await request(app).get(`/api/assessments/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe("idle");
  });

  it("returns 404 for an unknown assessment ID", async () => {
    const res = await request(app).get("/api/assessments/nonexistent-id");
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe("string");
  });
});

// ─── Question paper upload ──────────────────────────────────────────────────

describe("POST /api/assessments/:id/question-paper", () => {
  it("uploads a PDF and stores Cloudinary metadata in the assessment", async () => {
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app)
      .post(`/api/assessments/${assessment.id}/question-paper`)
      .attach("file", PDF_BUFFER, { filename: "paper.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.questionPaper).toMatchObject({
      publicId: FAKE_ASSET.publicId,
      secureUrl: FAKE_ASSET.secureUrl,
      originalFilename: FAKE_ASSET.originalFilename,
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.any(Buffer),
      `question-papers/${assessment.id}`,
      "paper.pdf"
    );
  });

  it("returns 404 when the assessment does not exist", async () => {
    const res = await request(app)
      .post("/api/assessments/nonexistent-id/question-paper")
      .attach("file", PDF_BUFFER, { filename: "paper.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 400 for an unsupported file type", async () => {
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app)
      .post(`/api/assessments/${assessment.id}/question-paper`)
      .attach("file", Buffer.from("data"), {
        filename: "malware.exe",
        contentType: "application/octet-stream",
      });

    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 400 when no file is sent", async () => {
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app).post(
      `/api/assessments/${assessment.id}/question-paper`
    );

    expect(res.status).toBe(400);
  });

  it("returns 500 when Cloudinary upload fails", async () => {
    mockUpload.mockRejectedValueOnce(new Error("Cloudinary network error"));
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app)
      .post(`/api/assessments/${assessment.id}/question-paper`)
      .attach("file", PDF_BUFFER, { filename: "paper.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(500);
  });

  it("accepts JPEG images", async () => {
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app)
      .post(`/api/assessments/${assessment.id}/question-paper`)
      .attach("file", Buffer.from("jpeg data"), {
        filename: "scan.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
  });
});

// ─── Answer sheet upload ────────────────────────────────────────────────────

describe("POST /api/assessments/:id/answer-sheet", () => {
  it("uploads a PDF and stores Cloudinary metadata in the assessment", async () => {
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app)
      .post(`/api/assessments/${assessment.id}/answer-sheet`)
      .attach("file", PDF_BUFFER, { filename: "answers.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.answerSheet).toMatchObject({
      publicId: FAKE_ASSET.publicId,
      secureUrl: FAKE_ASSET.secureUrl,
    });
    expect(mockUpload).toHaveBeenCalledWith(
      expect.any(Buffer),
      `answer-sheets/${assessment.id}`,
      "answers.pdf"
    );
  });

  it("returns 404 when the assessment does not exist", async () => {
    const res = await request(app)
      .post("/api/assessments/nonexistent-id/answer-sheet")
      .attach("file", PDF_BUFFER, { filename: "answers.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for an unsupported file type", async () => {
    const { body: assessment } = await request(app).post("/api/assessments");

    const res = await request(app)
      .post(`/api/assessments/${assessment.id}/answer-sheet`)
      .attach("file", Buffer.from("data"), {
        filename: "file.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
  });
});

// ─── Full round-trip ────────────────────────────────────────────────────────

describe("Full assessment round-trip", () => {
  it("creates, uploads both documents, and retrieves the final state", async () => {
    // 1. Create
    const { body: created } = await request(app).post("/api/assessments");
    expect(created.status).toBe("idle");

    // 2. Upload question paper
    const qpAsset: CloudinaryAsset = { ...FAKE_ASSET, publicId: "question-papers/qp" };
    mockUpload.mockResolvedValueOnce(qpAsset);
    await request(app)
      .post(`/api/assessments/${created.id}/question-paper`)
      .attach("file", PDF_BUFFER, { filename: "qp.pdf", contentType: "application/pdf" })
      .expect(200);

    // 3. Upload answer sheet
    const asAsset: CloudinaryAsset = { ...FAKE_ASSET, publicId: "answer-sheets/as" };
    mockUpload.mockResolvedValueOnce(asAsset);
    await request(app)
      .post(`/api/assessments/${created.id}/answer-sheet`)
      .attach("file", PDF_BUFFER, { filename: "as.pdf", contentType: "application/pdf" })
      .expect(200);

    // 4. Retrieve
    const { body: final } = await request(app).get(`/api/assessments/${created.id}`);
    expect(final.questionPaper.publicId).toBe("question-papers/qp");
    expect(final.answerSheet.publicId).toBe("answer-sheets/as");
    // Cloudinary secret must not appear in the response
    expect(JSON.stringify(final)).not.toContain(process.env.CLOUDINARY_API_SECRET ?? "SHOULD_NOT_APPEAR");
  });
});
