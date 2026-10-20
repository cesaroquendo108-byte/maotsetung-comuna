import { COMMUNITY_CONFIG } from '../config/community.js';

export default function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label={COMMUNITY_CONFIG.name}>
      <span className="brand-copy">
        <strong>{COMMUNITY_CONFIG.name}</strong>
        {!compact && <small>Parroquia San Agustín · ENAHP</small>}
      </span>
      <span className="brand-rule" aria-hidden="true" />
    </div>
  );
}
