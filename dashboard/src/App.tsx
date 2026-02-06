import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import BlogIndex from './pages/BlogIndex';
import HunterProfile from './pages/HunterProfile';
import BlogPost from './pages/BlogPost';
import AgentDashboard from './pages/AgentDashboard';
import ClaimAgent from './pages/ClaimAgent';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="blog" element={<BlogIndex />} />
          <Route path="blog/hunter" element={<HunterProfile />} />
          <Route path="blog/hunter/:slug" element={<BlogPost />} />
          <Route path="agents/:uuid" element={<AgentDashboard />} />
          <Route path="claim/:uuid" element={<ClaimAgent />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
