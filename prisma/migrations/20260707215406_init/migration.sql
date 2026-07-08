-- AlterTable
ALTER TABLE "data_entries" ADD COLUMN     "fileUrl" TEXT;

-- AddForeignKey
ALTER TABLE "classification_audits" ADD CONSTRAINT "classification_audits_dataEntryId_fkey" FOREIGN KEY ("dataEntryId") REFERENCES "data_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
