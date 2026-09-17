export interface AttachmentRecord {
  id: string;
  taskId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  url: string;
  createdAt: Date;
}

export interface CreateAttachmentData {
  taskId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  url: string;
}

export interface AttachmentRepository {
  create(data: CreateAttachmentData): Promise<AttachmentRecord>;
  list(taskId: string): Promise<AttachmentRecord[]>;
  findById(id: string): Promise<AttachmentRecord | null>;
  delete(id: string): Promise<void>;
}

/** An uploaded file's bytes + metadata, as parsed from the request. */
export interface UploadedFile {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** Where file bytes actually live (local disk now; S3/GCS-ready). */
export interface AttachmentStorage {
  save(file: UploadedFile): Promise<{ storageKey: string; url: string; sizeBytes: number }>;
  remove(storageKey: string): Promise<void>;
}
