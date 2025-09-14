import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import "./index.css"; // Assuming you have this for global styles

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Route for the homepage */}
        <Route path="/" element={<App />} />
        {/* Route for when a player is specified in the URL */}
        <Route path="/player/:region/:username/:tag" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);