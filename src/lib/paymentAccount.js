export const OFFICIAL_PAYMENT_ACCOUNT = {
  bank: 'Banco de Venezuela (BDV 0102)',
  bankCode: '0102',
  phone: '04125656452',
  idNumber: '6218460',
  idFormatted: 'V-6218460',
  holderName: 'Comuna Mao Tse Tung'
};

/**
 * Copies text to clipboard and returns success boolean.
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}
