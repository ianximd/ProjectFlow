import { Box, Folder as FolderIcon, List as ListIcon } from 'lucide-react';

// Display labels for the hierarchy node kinds (space/folder/list) and their
// plurals now live in the `Hierarchy` message catalog namespace and are
// translated at each render site (this is a non-component module and can't call
// useTranslations). Only the icon map remains here.
export const HIERARCHY_ICONS = { space: Box, folder: FolderIcon, list: ListIcon } as const;
