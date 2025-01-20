import React from 'react';
import ReactDOM from 'react-dom/client';
import VideoGenerator from './App.js'; // Added .js extension
import reportWebVitals from './reportWebVitals.js'; // Added .js extension
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <VideoGenerator/>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();