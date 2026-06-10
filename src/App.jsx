import { Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";

import Home from "./pages/Home.jsx";
import Characters from "./pages/Characters.jsx";
import CharacterNew from "./pages/CharacterNew.jsx";
import Events from "./pages/Events.jsx";
import EventDetail from "./pages/EventDetail.jsx";
import Draw from "./pages/Draw.jsx";
import MyPage from "./pages/MyPage.jsx";

export default function App() {
  return (
    <>
      <Header />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/characters" element={<Characters />} />
        <Route path="/characters/new" element={<CharacterNew />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/:eventId" element={<EventDetail />} />
        <Route path="/draw/:requestId" element={<Draw />} />
        <Route path="/mypage" element={<MyPage />} />
      </Routes>
    </>
  );
}
