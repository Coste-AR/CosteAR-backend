/**
 * Plantillas de email de CosteAR. Un layout único, con branding consistente, que
 * renderiza HTML compatible con Gmail/Outlook (tablas + estilos inline, ancho
 * máximo, responsive). No usa dependencias externas: es HTML puro tipado.
 */

const BRAND = {
  granate: '#6E1423',
  action: '#C2192A',
  ink: '#16181D',
  muted: '#5B6066',
  surface: '#ffffff',
  surfaceAlt: '#f6f5f3',
  line: '#e6e4e3',
};

interface LayoutOptions {
  heading: string;
  bodyHtml: string;
  /** Texto de preview (lo que muestra Gmail al lado del asunto). */
  preheader?: string;
  /** Nota gris al pie (aclaraciones, "si no fuiste vos…"). */
  footerNote?: string;
}

/** Envuelve el contenido en el layout branded de CosteAR. */
export function emailLayout({ heading, bodyHtml, preheader, footerNote }: LayoutOptions): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background:${BRAND.surfaceAlt};font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};-webkit-font-smoothing:antialiased">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surfaceAlt};padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden">
          <tr>
            <td style="background:${BRAND.granate};padding:20px 28px">
              <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.02em">CosteAR</span>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 34px">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${BRAND.ink}">${heading}</h1>
              <div style="font-size:15px;line-height:1.6;color:${BRAND.ink}">${bodyHtml}</div>
              ${footerNote ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:${BRAND.muted}">${footerNote}</p>` : ''}
            </td>
          </tr>
        </table>
        <p style="max-width:560px;margin:16px auto 0;font-size:11px;color:${BRAND.muted};text-align:center">CosteAR · Costeo industrial · Hecho en Tucumán 🇦🇷</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Botón de acción (granate). Table-based para máxima compatibilidad. */
export function emailButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0">
    <tr>
      <td style="border-radius:8px;background:${BRAND.granate}">
        <a href="${url}" target="_blank" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${label}</a>
      </td>
    </tr>
  </table>`;
}

/** Caja destacada para un código (invitación, empresa). */
export function emailCodeBox(label: string, code: string, note?: string): string {
  return `<div style="background:${BRAND.surfaceAlt};border:1px solid ${BRAND.line};border-radius:10px;padding:20px;margin:18px 0;text-align:center">
    <p style="margin:0 0 6px;font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:2px">${label}</p>
    <p style="margin:0;font-size:26px;font-weight:700;font-family:'Courier New',monospace;letter-spacing:4px;color:${BRAND.granate}">${code}</p>
    ${note ? `<p style="margin:8px 0 0;font-size:12px;color:${BRAND.muted}">${note}</p>` : ''}
  </div>`;
}

export { BRAND };
