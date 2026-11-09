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
  /** 1.23.7: uploaded by a client in the Client portal (shown "From client"). */
  fromClient?: boolean;
  /** 1.23.7: "Show to client" — clients of the project who may view tasks see it in the portal. */
  clientVisible?: boolean;
}

export interface CreateAttachmentData {
  taskId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  url: string;
  /** 1.23.7: a client's upload from the Client portal. */
  fromClient?: boolean;
}

export interface AttachmentRepository {
  create(data: CreateAttachmentData): Promise<AttachmentRecord>;
  list(taskId: string): Promise<AttachmentRecord[]>;
  findById(id: string): Promise<AttachmentRecord | null>;
  delete(id: string): Promise<void>;
  /** 1.23.7: the "Show to client" tick. */
  setClientVisible?(id: string, visible: boolean): Promise<AttachmentRecord>;
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
  /** The stored bytes (for in-app previews); absent when the store can't read back. */
  read?(storageKey: string): Promise<Buffer>;
}
