import React from 'react';
import Dashboard from './Dashboard';
import PassForm from './PassForm';
import EntryLog from './EntryLog';
import GatePassRequests from './GatePassRequests';

const GuardView = ({ activeTab, setActiveTab, onAddEntry, onVoiceClick, onDeleteEntry, onUpdateStatus, entries, selectedDept }) => {
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard entries={entries} setActiveTab={setActiveTab} onUpdateStatus={onUpdateStatus} />;
      case 'incoming':
        return <PassForm onAddEntry={onAddEntry} onVoiceClick={onVoiceClick} selectedDept={selectedDept} />;
      case 'requests':
        return <GatePassRequests entries={entries} onUpdateStatus={onUpdateStatus} />;
      case 'logs':
        return <EntryLog entries={entries} onDeleteEntry={onDeleteEntry} />;
      default:
        return <Dashboard entries={entries} setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div className="guard-view-container">
      {renderContent()}
      <style>{`
        .guard-view-container {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
        }
      `}</style>
    </div>
  );
};

export default GuardView;
