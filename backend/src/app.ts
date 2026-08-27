import express from "express";
import healthRouter from "./routes/health";
import assessmentsRouter from "./routes/assessments";
import extractionRouter from "./routes/extraction";
import mappingRouter from "./routes/mapping";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

app.use(express.json({ limit: "10mb" })); // base64 images can be large

app.use("/api/health", healthRouter);
app.use("/api/assessments", assessmentsRouter);
app.use("/api/extract", extractionRouter);
app.use("/api/map", mappingRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
