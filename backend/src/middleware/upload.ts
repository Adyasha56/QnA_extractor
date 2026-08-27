import multer from "multer";
import { RequestHandler, Request, Response, NextFunction } from "express";

const ALLOWED_MIMETYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        Object.assign(
          new Error(
            `Unsupported file type "${file.mimetype}". Allowed: PDF, JPEG, PNG, WebP, TIFF.`
          ),
          { statusCode: 400 }
        )
      );
    }
  },
});

// Wraps multer so that MulterError (e.g. file-size limit) becomes a 400 AppError.
export function singleFileUpload(fieldName: string): RequestHandler {
  const middleware = multerInstance.single(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "File too large. Maximum size is 20 MB."
            : err.message;
        return next(Object.assign(new Error(message), { statusCode: 400 }));
      }
      next(err);
    });
  };
}
