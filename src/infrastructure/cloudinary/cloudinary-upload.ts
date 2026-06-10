import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ?? 'dzjkuhshn',
  api_key:    process.env.CLOUDINARY_API_KEY    ?? '559364243212591',
  api_secret: process.env.CLOUDINARY_API_SECRET ?? 'ROHhcB7k-xWBGF6OXS0dE9xHu8E',
});

/**
 * Sube un archivo (base64) a Cloudinary y devuelve la URL segura.
 * Carpeta: costear/entries/
 */
export async function uploadToCloudinary(
  base64Data: string,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  const resourceType = mimeType.startsWith('image/') ? 'image' : 'raw';

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: 'costear/entries',
    resource_type: resourceType,
    public_id: `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
    overwrite: false,
  });

  return result.secure_url;
}
