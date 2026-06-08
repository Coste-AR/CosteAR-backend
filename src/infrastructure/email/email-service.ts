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
