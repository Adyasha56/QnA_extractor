import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";
import { CloudinaryAsset } from "../models/assessment";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  originalFilename: string
): Promise<CloudinaryAsset> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", use_filename: false, unique_filename: true },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload returned no result"));
          return;
        }
        resolve({
          publicId: result.public_id,
          secureUrl: result.secure_url,
          resourceType: result.resource_type,
          format: result.format,
          originalFilename,
        });
      }
    );
    stream.end(buffer);
  });
}
