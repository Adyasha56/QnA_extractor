import express from "express";
import healthRouter from "./routes/health";
import assessmentsRouter from "./routes/assessments";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/assessments", assessmentsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
