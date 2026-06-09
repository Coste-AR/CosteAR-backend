-- Agrega flag mustChangePassword para operadores invitados
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
