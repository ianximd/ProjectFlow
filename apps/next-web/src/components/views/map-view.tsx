'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';

import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import { parseLocationValue } from '@/lib/location';
import type { LiveScopeProp } from '@/components/views/view-surface';
import { taskFieldValue } from './field-options';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { CustomField } from '@projectflow/types';

import styles from './map-view.module.css';

// ── Leaflet CSS (client-only; must load before MapContainer mounts) ───────────
// Importing the CSS here (inside a 'use client' module) ensures it is bundled
// on the client side only and doesn't attempt SSR access to `window`.
import 'leaflet/dist/leaflet.css';

// ── Type-only stubs so we can type the dynamic refs before they load ──────────
import type { Map as LeafletMap, LatLngExpression } from 'leaflet';

// ── Dynamic imports (ssr: false) — leaflet touches window at import time ──────
// Each component is loaded lazily so the SSR pass never imports the leaflet
// module. `'use client'` alone does NOT prevent SSR execution; dynamic() does.
const MapContainer = dynamic(
  () => import('react-leaflet').then((m) => m.MapContainer),
  { ssr: false },
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((m) => m.TileLayer),
  { ssr: false },
);
const Marker = dynamic(
  () => import('react-leaflet').then((m) => m.Marker),
  { ssr: false },
);
const Popup = dynamic(
  () => import('react-leaflet').then((m) => m.Popup),
  { ssr: false },
);

// ── Leaflet default-marker icon fix ──────────────────────────────────────────
// Webpack / Next.js breaks leaflet's default icon because the bundler rewrites
// the image URLs that Leaflet bakes in at build time. Without this fix, <Marker>
// renders no icon and `.leaflet-marker-icon` is absent from the DOM. We apply
// the standard mergeOptions fix inside a useEffect so it only runs on the
// client, after the leaflet module has loaded.
function useLeafletIconFix() {
  useEffect(() => {
    // Dynamic import keeps this entirely out of the SSR bundle.
    void import('leaflet').then((L) => {
      // Next.js static image imports return an object with a `src` string (the
      // public URL). We load the images via dynamic import so they go through
      // the same pipeline as any other static asset, giving us real public URLs.
      void Promise.all([
        import('leaflet/dist/images/marker-icon-2x.png'),
        import('leaflet/dist/images/marker-icon.png'),
        import('leaflet/dist/images/marker-shadow.png'),
      ]).then(([iconRetina, iconMod, shadow]) => {
        // Next.js image imports may return either a plain string URL or an
        // object with a `src` property depending on the build mode. Handle both.
        const toUrl = (mod: unknown): string => {
          if (typeof mod === 'string') return mod;
          if (mod && typeof (mod as { src?: string }).src === 'string') {
            return (mod as { src: string }).src;
          }
          // Fallback: default export
          const def = (mod as { default?: unknown })?.default;
          if (typeof def === 'string') return def;
          if (def && typeof (def as { src?: string }).src === 'string') {
            return (def as { src: string }).src;
          }
          return '';
        };

        L.Icon.Default.mergeOptions({
          iconRetinaUrl: toUrl(iconRetina),
          iconUrl: toUrl(iconMod),
          shadowUrl: toUrl(shadow),
        });
      });
    });
  }, []);
}

// ── Resolved pin shape (derived client-side from tasks + custom fields) ───────
interface Pin {
  taskId: string;
  task: Task;
  lat: number;
  lng: number;
  label: string;
}

/** Derive map pins from the task page. For each task, scan its custom fields
 *  for the first field of type 'location'; decode the value and keep the pin
 *  when it's a valid LocationValue. */
function derivePins(tasks: Task[], customFields: CustomField[]): Pin[] {
  const locationFields = customFields.filter((f) => f.type === 'location');
  const pins: Pin[] = [];

  for (const task of tasks) {
    for (const f of locationFields) {
      const raw = taskFieldValue(task, { kind: 'custom', key: f.id }, customFields);
      const loc = parseLocationValue(raw);
      if (loc) {
        pins.push({ taskId: task.id, task, lat: loc.lat, lng: loc.lng, label: loc.label });
        break; // use only the first valid location field per task
      }
    }
  }
  return pins;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  /** Paged tasks for the active view. Null when no view is active (handled upstream). */
  taskPage: ViewTaskPageResult | null;
  /** The active saved view (kept for config access / future filter wiring). */
  activeView: import('@projectflow/types').SavedView;
  /** The scope's custom fields — used to identify location-type fields. */
  customFields?: CustomField[];
  /** Live-subscription scope (created/updated/deleted), resolved SSR in the page. */
  live: LiveScopeProp;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MapView({ taskPage, customFields = [], live }: Props) {
  const t = useTranslations('Map');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Apply the leaflet marker-icon fix once on mount.
  useLeafletIconFix();

  // Merge live task events onto the SSR page (identical to other view renderers).
  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );

  // Derive pins from the merged task list + custom fields.
  const pins = useMemo(() => derivePins(tasks, customFields), [tasks, customFields]);

  // The selected pin's task (for the side panel).
  const selectedPin = useMemo(
    () => (selectedTaskId ? pins.find((p) => p.taskId === selectedTaskId) ?? null : null),
    [selectedTaskId, pins],
  );

  // Map center: first pin, or world view when empty.
  const center: LatLngExpression = pins.length > 0 ? [pins[0]!.lat, pins[0]!.lng] : [0, 0];
  const zoom = pins.length > 0 ? 4 : 1;

  return (
    <div data-testid="view-body-map" className={styles.root}>
      <MapContainer
        className={styles.map}
        center={center}
        zoom={zoom}
        scrollWheelZoom
        // react-leaflet v5 does not forward unknown props as DOM attributes;
        // the `style` prop is the safe way to set dimensions.
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <Marker
            key={pin.taskId}
            position={[pin.lat, pin.lng]}
            eventHandlers={{
              click: () => setSelectedTaskId(pin.taskId),
            }}
          >
            <Popup>
              <span className="text-xs font-medium">
                {pin.task.title || t('untitled')}
              </span>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Empty-state overlay (absolute, pointer-events none — sits above the map) */}
      {pins.length === 0 && (
        <div className={styles.empty}>
          {t('noLocatedTasks')}
        </div>
      )}

      {/* Side panel — shown when a pin is selected */}
      {selectedPin && (
        <aside data-testid="map-task-panel" className={styles.panel}>
          <button
            type="button"
            className={styles.close}
            aria-label={t('close')}
            onClick={() => setSelectedTaskId(null)}
          >
            ×
          </button>
          <p className={styles.panelTitle}>
            {selectedPin.task.title || t('untitled')}
          </p>
          {selectedPin.task.issueKey && (
            <p className={styles.panelKey}>{selectedPin.task.issueKey}</p>
          )}
          <p className={styles.panelStatus}>{selectedPin.task.status}</p>
        </aside>
      )}
    </div>
  );
}
