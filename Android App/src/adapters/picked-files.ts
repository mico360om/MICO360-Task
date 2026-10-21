import * as FileSystem from 'expo-file-system';
import { createPickedFiles } from '../lib/picked-files';

/** The picker's copies in this app's cache (lib/picked-files): deleted once sent or discarded, and at sign-out. */
export const pickedFiles = createPickedFiles({ deleteAsync: (uri, opts) => FileSystem.deleteAsync(uri, opts) }, FileSystem.cacheDirectory);
