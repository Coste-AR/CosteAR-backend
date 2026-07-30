-- AlterTable
ALTER TABLE "data_entries" ADD COLUMN     "processDepartmentId" UUID;

-- CreateIndex
CREATE INDEX "data_entries_processDepartmentId_idx" ON "data_entries"("processDepartmentId");

-- AddForeignKey
ALTER TABLE "data_entries" ADD CONSTRAINT "data_entries_processDepartmentId_fkey" FOREIGN KEY ("processDepartmentId") REFERENCES "process_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
