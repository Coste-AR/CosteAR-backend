import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { getEnv } from '../config/env.js';
import { emailLayout, emailButton, emailCodeBox } from './email-templates.js';

/**
 * Envío de emails transaccionales vía Resend o SMTP. En test y development (sin API
 * key o SMTP real) cae a un modo "log only" que no hace llamadas de red.
 */
export class EmailService {
  private readonly resend: Resend | null = null;
  private readonly transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor() {
    const env = getEnv();
    this.from = env.EMAIL_FROM;

    if (env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT || 587,
        secure: env.SMTP_SECURE === 'true',
        auth: env.SMTP_USER && env.SMTP_PASS ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        } : undefined,
        // Timeouts para que un envío nunca quede colgado indefinidamente.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      // Gmail/SMTP exige que el "from" sea la casilla autenticada. Si EMAIL_FROM
      // no la contiene, usamos SMTP_USER para no ser rechazados (mantenemos el
      // nombre lindo "CosteAR").
      const fromEmail = this.from.match(/<([^>]+)>/)?.[1]?.trim() ?? this.from.trim();
      if (env.SMTP_USER && fromEmail.toLowerCase() !== env.SMTP_USER.toLowerCase()) {
        this.from = `CosteAR <${env.SMTP_USER}>`;
      }
    } else {
      const usable =
        env.NODE_ENV === 'production' || env.RESEND_API_KEY.startsWith('re_') === true;
      this.resend = usable && env.RESEND_API_KEY !== 're_test_placeholder'
        ? new Resend(env.RESEND_API_KEY)
        : null;
    }
  }

  /** Diagnóstico: verifica la conexión/credenciales SMTP sin enviar nada. */
  async verifyConnection(): Promise<{ mode: string; from: string; ok: boolean; error?: string }> {
    if (this.transporter) {
      try {
        await this.transporter.verify();
        return { mode: 'smtp', from: this.from, ok: true };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return { mode: 'smtp', from: this.from, ok: false, error: `${e.code ?? ''} ${e.message ?? String(err)}`.trim() };
      }
    }
    return { mode: this.resend ? 'resend' : 'dev-log', from: this.from, ok: false, error: 'Sin transporter SMTP (SMTP_HOST no seteado)' };
  }

  /** Diagnóstico: envía un email de prueba REAL y devuelve el resultado exacto. */
  async sendTest(to: string): Promise<{ mode: string; from: string; ok: boolean; id?: string; error?: string }> {
    const html = emailLayout({
      heading: 'Prueba de envío',
      bodyHtml: '<p style="margin:0">Si estás viendo este mail, el envío de CosteAR funciona correctamente. 🎉</p>',
    });
    const subject = 'CosteAR — Prueba de email';
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({ from: this.from, to, subject, html });
        return { mode: 'smtp', from: this.from, ok: true, id: info.messageId };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return { mode: 'smtp', from: this.from, ok: false, error: `${e.code ?? ''} ${e.message ?? String(err)}`.trim() };
      }
    }
    if (this.resend) {
      const r = await this.resend.emails.send({ from: this.from, to, subject, html });
      if (r.error) return { mode: 'resend', from: this.from, ok: false, error: `${r.error.name}: ${r.error.message}` };
      return { mode: 'resend', from: this.from, ok: true, id: r.data?.id };
    }
    return { mode: 'dev-log', from: this.from, ok: false, error: 'No hay transporter ni Resend configurados' };
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.from,
          to,
          subject,
          html,
        });
      } catch (err) {
        console.error(`[email:smtp] Error al enviar a ${to}:`, err);
        throw err;
      }
      return;
    }

    if (!this.resend) {
      // Modo desarrollo/test: no enviamos, dejamos rastro en consola.
      console.info(`[email:dev] → ${to} · ${subject}`);
      return;
    }
    try {
      const response = await this.resend.emails.send({ from: this.from, to, subject, html });
      if (response.error) {
        throw new Error(response.error.message);
      }
    } catch (err) {
      console.warn(`[email] Error al enviar desde ${this.from}, reintentando con onboarding@resend.dev:`, err);
      try {
        const responseFallback = await this.resend.emails.send({ from: 'onboarding@resend.dev', to, subject, html });
        if (responseFallback.error) {
          throw new Error(responseFallback.error.message);
        }
      } catch (fallbackErr) {
        console.error(`[email] También falló el envío fallback:`, fallbackErr);
        throw fallbackErr;
      }
    }
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const env = getEnv();
    const url = `${env.CORS_ORIGIN.split(',')[0]}/reset-password?token=${token}`;
    await this.send(
      to,
      'CosteAR — Restablecé tu contraseña',
      emailLayout({
        heading: 'Restablecé tu contraseña',
        preheader: 'Pedido de restablecimiento de contraseña en CosteAR.',
        bodyHtml: `<p style="margin:0">Recibimos un pedido para restablecer tu contraseña. Hacé clic en el botón para elegir una nueva:</p>${emailButton('Restablecer contraseña', url)}`,
        footerNote: 'El enlace vence en 1 hora. Si no fuiste vos, ignorá este mensaje — tu contraseña no cambia.',
      }),
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
      emailLayout({
        heading: `Te invitaron a ${companyName}`,
        preheader: `Código de invitación al portal de ${companyName}.`,
        bodyHtml:
          `<p style="margin:0 0 12px">Hola <strong>${operatorName}</strong>,</p>` +
          `<p style="margin:0 0 4px">Te invitaron a cargar datos para <strong>${companyName}</strong> en CosteAR. Como ya tenés una cuenta, ingresá y aceptá la invitación con este código:</p>` +
          emailCodeBox('Código de invitación', inviteCode, 'Válido por 7 días') +
          emailButton('Ir al portal', loginUrl),
        footerNote: 'Si no esperabas esta invitación, ignorá este mensaje.',
      }),
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
      emailLayout({
        heading: `Tu acceso a ${companyName}`,
        preheader: `Credenciales de acceso al portal de ${companyName}.`,
        bodyHtml:
          `<p style="margin:0 0 12px">Hola <strong>${operatorName}</strong>,</p>` +
          `<p style="margin:0 0 4px">Tu costista te habilitó el acceso al portal de carga de datos de <strong>${companyName}</strong>. Estas son tus credenciales:</p>` +
          `<div style="background:#f6f5f3;border:1px solid #e6e4e3;border-radius:10px;padding:18px;margin:16px 0">` +
            `<p style="margin:0 0 8px;font-size:11px;color:#5B6066;text-transform:uppercase;letter-spacing:2px">Tus credenciales</p>` +
            `<p style="margin:4px 0"><strong>Email:</strong> ${to}</p>` +
            `<p style="margin:4px 0"><strong>Contraseña temporal:</strong> <code style="background:#e8e6e3;padding:2px 6px;border-radius:4px;font-family:'Courier New',monospace">${tempPassword}</code></p>` +
          `</div>` +
          `<p style="margin:0">Al ingresar por primera vez, vas a poder cambiar tu contraseña.</p>` +
          (inviteCode ? emailCodeBox('Código de empresa', inviteCode) : '') +
          emailButton('Ingresar al portal', loginUrl),
        footerNote: 'Si no esperabas este acceso, ignorá este mensaje.',
      }),
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
      emailLayout({
        heading: 'Alerta de margen',
        preheader: `El margen de ${productName} cayó por debajo de tu umbral.`,
        bodyHtml:
          `<p style="margin:0 0 10px">El margen de <strong>${productName}</strong> en <strong>${companyName}</strong> cayó a <strong style="color:#B91C1C">${marginPct.toFixed(1)}%</strong>, por debajo de tu umbral de ${thresholdPct.toFixed(1)}%.</p>` +
          `<p style="margin:0">Revisá la estructura de costos antes de que el cliente venda sin margen.</p>`,
      }),
    );
  }
}
