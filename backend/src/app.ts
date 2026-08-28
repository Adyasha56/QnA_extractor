import express from "express";
import cors from "cors";
import healthRouter from "./routes/health";
import assessmentsRouter from "./routes/assessments";
import extractionRouter from "./routes/extraction";
import mappingRouter from "./routes/mapping";
import benchmarkRouter from "./routes/benchmark";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

// CORS — allow the Next.js frontend origin.
// In development: permit all origins so curl/Hoppscotch work without config.
// In production: restrict to CORS_ORIGIN env var (set this on the host).
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "10mb" })); // base64 images can be large

app.use("/api/health", healthRouter);
app.use("/api/assessments", assessmentsRouter);
app.use("/api/extract", extractionRouter);
app.use("/api/map", mappingRouter);
app.use("/api/benchmark", benchmarkRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
