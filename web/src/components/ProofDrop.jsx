'use client';

import { useEffect, useState } from 'react';
import { PROOF_ACCEPT, PROOF_MAX_BYTES, PROOF_MAX_LABEL, isImageFile, shrinkProofImage } from '@/lib/proofFile';

// The "upload your receipt" box, used everywhere a payment is proved: the
// member's registration, Pay Now, the walk-in desk, the public form.
//
// It exists as one component because the three copies of it had all quietly
// assumed the receipt is a picture - `<img src={URL.createObjectURL(file)}>` -
// and a payer whose bank emails a PDF got a broken-image icon and no way to
// tell whether their file had been attached at all.
export default function ProofDrop({
  file,
  onPick,
  invalid = false,
  label = 'Upload a screenshot or file of your receipt',
  hint = 'Photo, screenshot or PDF from your bank or payment app',
  id,
}) {
  const [preview, setPreview] = useState('');
  const [tooBig, setTooBig] = useState('');
  const [busy, setBusy] = useState(false);   // re-encoding a photo takes a beat

  // Object URLs are revoked when the file changes or the box unmounts;
  // creating one per render (the old inline `URL.createObjectURL`) leaks a blob
  // on every keystroke elsewhere in the form.
  useEffect(() => {
    if (!isImageFile(file)) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handle = async (raw) => {
    setTooBig('');
    if (!raw) { onPick(null); return; }
    // A photo of a screen is 3-5MB of JPEG; re-encoded it is a couple of
    // hundred KB. Done before the size check, so the only thing that can be
    // "too big" is a document.
    setBusy(true);
    const picked = await shrinkProofImage(raw);
    setBusy(false);
    if (picked.size > PROOF_MAX_BYTES) {
      // Said here rather than left to fail on upload, where a platform body
      // limit answers with a bare 413 and no explanation.
      setTooBig(`That file is ${(picked.size / 1024 / 1024).toFixed(1)}MB. Please attach one under ${PROOF_MAX_LABEL}.`);
      onPick(null);
      return;
    }
    onPick(picked);
  };

  const isImage = isImageFile(file);
  const sizeKb = file ? `${(file.size / 1024).toFixed(0)} KB` : '';

  return (
    <>
      <label className={`evt-proof-drop ${invalid || tooBig ? 'evt-field-error' : ''}`} htmlFor={id}>
        <input
          id={id}
          type="file"
          accept={PROOF_ACCEPT}
          onChange={(e) => handle(e.target.files?.[0] || null)}
        />
        {isImage && preview
          ? <img src={preview} alt="Payment receipt" />
          : (
            <span className="evt-proof-icon">
              <i className={`fas ${busy ? 'fa-spinner fa-spin' : file ? 'fa-file-lines' : 'fa-cloud-arrow-up'}`}></i>
            </span>
          )}
        <span className="evt-proof-text">
          <strong>{busy ? 'Preparing your receipt…' : file ? file.name : label}</strong>
          <small>{file && !busy ? `${sizeKb} · Tap to choose a different file` : hint}</small>
        </span>
      </label>
      {tooBig && <div className="evt-field-error-msg">{tooBig}</div>}
    </>
  );
}
