import { v2 as cloudinary } from 'cloudinary';

/**
 * Configuración de Cloudinary. Las credenciales SIEMPRE vienen de variables de
 * entorno — nunca se hardcodean (el api_secret es sensible). Si faltan, el
 * upload falla de forma controlada y el flujo sigue sin URL (no rompe el envío).
 */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey    = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isConfigured) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
} else {
  console.warn('[cloudinary] Credenciales no configuradas — los adjuntos no se subirán a Cloudinary.');
}

/**
 * Sube un archivo (base64) a Cloudinary y devuelve la URL segura.
 * Carpeta: costear/entries/
 *
 * Lanza si Cloudinary no está configurado o si la subida falla; el llamador
 * (empresa-portal-service) ya envuelve esto en try/catch y degrada sin romper.
 */
export async function uploadToCloudinary(
  base64Data: string,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (!isConfigured) {
    throw new Error('Cloudinary no está configurado (faltan CLOUDINARY_* en el entorno).');
  }

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
