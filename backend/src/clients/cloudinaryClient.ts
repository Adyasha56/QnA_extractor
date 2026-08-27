import { randomUUID } from "crypto";
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
  const publicId = `${folder}/${randomUUID().slice(0, 8)}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: "image", access_mode: "public", overwrite: false },
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
