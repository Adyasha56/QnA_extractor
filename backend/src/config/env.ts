import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
};
