import { Resend } from 'resend';
import { getEnv } from '../config/env.js';

/**
 * Envío de emails transaccionales vía Resend. En test y development (sin API
 * key real) cae a un modo "log only" que no hace llamadas de red.
 */
export class EmailService {
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const env = getEnv();
    this.from = env.EMAIL_FROM;
    const usable =
      env.NODE_ENV === 'production' || env.RESEND_API_KEY.startsWith('re_') === true;
    this.resend = usable && env.RESEND_API_KEY !== 're_test_placeholder'
      ? new Resend(env.RESEND_API_KEY)
      : null;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      // Modo desarrollo/test: no enviamos, dejamos rastro en consola.
      console.info(`[email:dev] → ${to} · ${subject}`);
      return;
    }
    await this.resend.emails.send({ from: this.from, to, subject, html });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const env = getEnv();
    const url = `${env.CORS_ORIGIN.split(',')[0]}/reset-password?token=${token}`;
    await this.send(
      to,
      'CosteAR — Restablecé tu contraseña',
      `<div style="font-family:Arial,sans-serif;color:#16181D">
        <h2 style="color:#6E1423">CosteAR</h2>
        <p>Recibimos un pedido para restablecer tu contraseña.</p>
        <p><a href="${url}" style="color:#C2192A">Restablecer contraseña</a></p>
        <p style="color:#5B6066;font-size:13px">El enlace vence en 1 hora. Si no fuiste vos, ignorá este mensaje.</p>
      </div>`,
    );
  }

  async sendOperatorInviteCode(
    to: string,
    operatorName: string,
    companyName: string,
    inviteCode: string,
  ): Promise<void> {
    const env = getEnv();
    const loginUrl = `${env.CORS_ORIGIN.split(',')[0]}/portal`;
    await this.send(
      to,
      `CosteAR — Invitación al portal de ${companyName}`,
      `<div style="font-family:Arial,sans-serif;color:#16181D;max-width:520px">
        <h2 style="color:#6E1423">CosteAR</h2>
        <p>Hola <strong>${operatorName}</strong>,</p>
        <p>Te invitaron a cargar datos para <strong>${companyName}</strong> en CosteAR.</p>
        <p>Como ya tenés una cuenta, ingresá y aceptá la invitación con este código:</p>
        <div style="background:#f6f5f3;border-radius:8px;padding:20px;margin:16px 0;text-align:center">
          <p style="margin:0 0 4px;font-size:12px;color:#5B6066;text-transform:uppercase;letter-spacing:2px">Código de invitación</p>
          <p style="margin:0;font-size:28px;font-weight:bold;font-family:monospace;letter-spacing:4px;color:#6E1423">${inviteCode}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#5B6066">Válido por 7 días</p>
        </div>
        <p><a href="${loginUrl}" style="background:#6E1423;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Ir al portal</a></p>
        <p style="color:#5B6066;font-size:12px;margin-top:24px">Si no esperabas esta invitación, ignorá este mensaje.</p>
      </div>`,
    );
  }

  async sendOperatorInvite(
    to: string,
    operatorName: string,
    companyName: string,
    tempPassword: string,
    inviteCode?: string,
  ): Promise<void> {
    const env = getEnv();
    const loginUrl = `${env.CORS_ORIGIN.split(',')[0]}/login`;
    await this.send(
      to,
      `CosteAR — Acceso al portal de ${companyName}`,
      `<div style="font-family:Arial,sans-serif;color:#16181D;max-width:520px">
        <h2 style="color:#6E1423">CosteAR</h2>
        <p>Hola <strong>${operatorName}</strong>,</p>
        <p>Tu costista te habilitó el acceso al portal de carga de datos de <strong>${companyName}</strong>.</p>
        <div style="background:#f6f5f3;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:13px;color:#5B6066">TUS CREDENCIALES</p>
          <p style="margin:4px 0"><strong>Email:</strong> ${to}</p>
          <p style="margin:4px 0"><strong>Contraseña temporal:</strong> <code style="background:#e8e6e3;padding:2px 6px;border-radius:4px">${tempPassword}</code></p>
        </div>
        <p>Al ingresar por primera vez, vas a poder cambiar tu contraseña.</p>
        ${inviteCode ? `
        <div style="background:#f6f5f3;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
          <p style="margin:0 0 4px;font-size:12px;color:#5B6066;text-transform:uppercase;letter-spacing:2px">Código de empresa</p>
          <p style="margin:0;font-size:22px;font-weight:bold;font-family:monospace;letter-spacing:3px;color:#6E1423">${inviteCode}</p>
        </div>` : ''}
        <p><a href="${loginUrl}" style="background:#6E1423;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Ingresar al portal</a></p>
        <p style="color:#5B6066;font-size:12px;margin-top:24px">Si no esperabas este acceso, ignorá este mensaje.</p>
      </div>`,
    );
  }

  async sendMarginAlert(
    to: string,
    companyName: string,
    productName: string,
    marginPct: number,
    thresholdPct: number,
  ): Promise<void> {
    await this.send(
      to,
      `CosteAR — Alerta de margen: ${companyName}`,
      `<div style="font-family:Arial,sans-serif;color:#16181D">
        <h2 style="color:#6E1423">CosteAR · Alerta de margen</h2>
        <p>El margen de <strong>${productName}</strong> en <strong>${companyName}</strong>
        cayó a <strong style="color:#B91C1C">${marginPct.toFixed(1)}%</strong>,
        por debajo de tu umbral de ${thresholdPct.toFixed(1)}%.</p>
        <p>Revisá la estructura de costos antes de que el cliente venda sin margen.</p>
      </div>`,
    );
  }
}
