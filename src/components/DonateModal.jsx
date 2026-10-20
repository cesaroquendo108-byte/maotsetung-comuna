import { useState } from 'react';
import { Modal } from './UI.jsx';
import { copyToClipboard } from '../lib/paymentAccount.js';

export default function DonateModal({ onClose, onToast }) {
  const [copiedField, setCopiedField] = useState(null);

  const handleCopy = async (field, text) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleDonated = () => {
    onToast?.({ message: 'Gracias por apoyar el desarrollo y mantenimiento de la plataforma comunal.', type: 'success' });
    onClose();
  };

  return (
    <Modal open onClose={onClose}>
      <div className="donate-modal-content">
        <div className="donate-heart-icon" aria-hidden="true">
          <span className="material-symbols-outlined">favorite</span>
        </div>

        <h2 className="donate-title">Mantén la plataforma comunal activa</h2>
        
        <p className="donate-description">
          Esta plataforma comunal es <strong>gratis y sin publicidad</strong>. Si te sirve, una donación ayuda a pagar el servidor, las APIs y las horas de mantenimiento. Cualquier monto cuenta.
        </p>

        <div className="donate-pm-card">
          <div className="donate-pm-badge">PAGO MÓVIL</div>
          
          <div className="donate-pm-grid">
            <div className="donate-pm-row">
              <div className="donate-pm-label">
                <span>BANCO</span>
                <strong>BNC · 0191</strong>
              </div>
              <button
                type="button"
                className="donate-copy-btn"
                onClick={() => handleCopy('bank', '0191')}
              >
                {copiedField === 'bank' ? '¡copiado!' : 'copiar'}
              </button>
            </div>

            <div className="donate-pm-row">
              <div className="donate-pm-label">
                <span>TELÉFONO</span>
                <strong className="mono">0412-6319964</strong>
              </div>
              <button
                type="button"
                className="donate-copy-btn"
                onClick={() => handleCopy('phone', '04126319964')}
              >
                {copiedField === 'phone' ? '¡copiado!' : 'copiar'}
              </button>
            </div>

            <div className="donate-pm-row">
              <div className="donate-pm-label">
                <span>CÉDULA</span>
                <strong className="mono">V-30.821.164</strong>
              </div>
              <button
                type="button"
                className="donate-copy-btn"
                onClick={() => handleCopy('id', '30821164')}
              >
                {copiedField === 'id' ? '¡copiado!' : 'copiar'}
              </button>
            </div>
          </div>

          <p className="donate-pm-hint">
            Toca un dato para copiarlo. Haz tu Pago Móvil desde tu banco y ¡listo!
          </p>
        </div>

        <button className="primary-button full donate-submit-btn" type="button" onClick={handleDonated}>
          Ya doné
        </button>

        <button className="link-button donate-dismiss-btn" type="button" onClick={onClose}>
          Quizás luego
        </button>
      </div>
    </Modal>
  );
}
