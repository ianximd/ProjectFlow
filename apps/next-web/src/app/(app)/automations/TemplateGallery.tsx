'use client';

import { useTranslations } from 'next-intl';
import type { AutomationTemplate } from '@projectflow/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import styles from './automations.module.css';

export function TemplateGallery({ open, templates, onClose, onUse }: {
  open:      boolean;
  templates: AutomationTemplate[];
  onClose:   () => void;
  onUse:     (tpl: AutomationTemplate) => void;
}) {
  const t = useTranslations('Automations');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('galleryTitle')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] overflow-y-auto">
          <p className="mb-3 text-xs text-muted-foreground">{t('gallerySubtitle')}</p>
          <div className={styles.galleryGrid}>
            {templates.map((tpl) => (
              <Card key={tpl.key} className="p-3 flex flex-col gap-2">
                <div className="text-sm font-semibold text-foreground">{tpl.title}</div>
                <div className="text-xs text-muted-foreground flex-1">{tpl.description}</div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" size="sm">{tpl.trigger.type}</Badge>
                  {tpl.actions.map((a, i) => (
                    <Badge key={i} variant="outline" size="sm">{a.type}</Badge>
                  ))}
                </div>
                <Button size="sm" variant="primary" onClick={() => onUse(tpl)}>
                  {t('useTemplate')}
                </Button>
              </Card>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
