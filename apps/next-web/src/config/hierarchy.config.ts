import { Box, Folder as FolderIcon, List as ListIcon } from 'lucide-react';

export const HIERARCHY_LABELS = { space: 'Space', folder: 'Folder', list: 'List' } as const;
export const HIERARCHY_LABELS_PLURAL = { space: 'Spaces', folder: 'Folders', list: 'Lists' } as const;
export const HIERARCHY_ICONS = { space: Box, folder: FolderIcon, list: ListIcon } as const;
