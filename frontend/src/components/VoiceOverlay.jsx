import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, X } from 'lucide-react';

const fieldLabels = {
  challanNo: 'Challan Number',
  partyName: 'Party Name',
  transportName: 'Transport Name',
  biltyNo: 'Bilty Number',
  designNo: 'Design Number',
  orderNo: 'Order Number',
  quantity: 'Quantity',
  parcelFrom: 'Source Location',
  description: 'Description',
};

const VoiceOverlay = ({ target, onClose, onResult }) => {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(true);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscript('Speech recognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN'; // Can be 'hi-IN'

    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map(result => result[0])
        .map(result => result.transcript)
        .join('');
      setTranscript(text);
      if (event.results[0].isFinal) {
        setTimeout(() => onResult(text), 1000);
      }
    };

    recognition.onerror = (event) => {
      console.error(event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();

    return () => recognition.stop();
  }, [onResult]);

  return (
    <motion.div 
      className="voice-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button className="close-btn" onClick={onClose}><X size={32} /></button>
      
      <div className="voice-content">
        <div className="mic-container">
          <div className="pulse-ring"></div>
          <div className="pulse-ring delay-1"></div>
          <div className="mic-circle">
            <Mic size={48} />
          </div>
        </div>

        <h2 className="status-text">{isListening ? 'Listening...' : 'Finished'}</h2>
        <p className="target-text">Speaking for: <span className="capitalize">{fieldLabels[target] || target}</span></p>
        
        <div className="transcript-box">
          {transcript || 'Say something...'}
        </div>
      </div>

      <style>{`
        .voice-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(7, 9, 13, 0.98);
          z-index: 2000;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(15px);
        }
        .close-btn {
          position: absolute;
          top: 30px;
          right: 30px;
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
        }
        .voice-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 30px;
          width: 80%;
          text-align: center;
        }
        .mic-container {
          position: relative;
          width: 120px;
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .mic-circle {
          width: 100px;
          height: 100px;
          background: var(--primary);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          z-index: 2;
          box-shadow: 0 0 40px var(--primary-glow);
        }
        .pulse-ring {
          position: absolute;
          width: 100px;
          height: 100px;
          background: var(--primary-glow);
          border-radius: 50%;
          animation: pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
          z-index: 1;
        }
        .delay-1 { animation-delay: 1s; }
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        .status-text { font-size: 1.8rem; font-weight: 800; color: white; }
        .target-text { color: var(--text-dim); font-size: 1rem; }
        .capitalize { text-transform: capitalize; color: var(--primary); font-weight: 700; }
        .transcript-box {
          margin-top: 20px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 24px;
          min-height: 100px;
          width: 100%;
          font-size: 1.2rem;
          color: var(--text-main);
          font-style: italic;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px dashed var(--border);
        }
      `}</style>
    </motion.div>
  );
};

export default VoiceOverlay;
