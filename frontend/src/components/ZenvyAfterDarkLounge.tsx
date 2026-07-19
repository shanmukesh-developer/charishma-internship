'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Phone, Users, Moon, Send, X } from 'lucide-react';
import socket from '@/utils/socket';
import { API_URL } from '@/utils/api';

export default function ZenvyAfterDarkLounge() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [inCall, setInCall] = useState(false);
  const [isAfterDark, setIsAfterDark] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Example predefined campus groups
  const groups = [
    { id: 'hostel_a_boys', name: 'Block A Boys (Hostel)' },
    { id: 'hostel_c_girls', name: 'Block C Girls (Hostel)' },
    { id: 'cse_study_group', name: 'CSE Late Night Coders' },
    { id: 'gaming_hub', name: 'Valorant/BGMI Hub' }
  ];

  // Time Gate Check
  useEffect(() => {
    const checkTime = () => {
      // Temporarily forced to true for testing
      setIsAfterDark(true);
    };
    checkTime();
    const interval = setInterval(checkTime, 60000);
    return () => clearInterval(interval);
  }, []);

  // Socket Listeners
  useEffect(() => {
    socket.on('receive_after_dark_message', (msg) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    socket.on('call_error', (data) => {
      alert(data.message);
      setInCall(false);
    });

    socket.on('user_joined_call', (data) => {
      console.log('User joined call:', data);
    });

    return () => {
      socket.off('receive_after_dark_message');
      socket.off('call_error');
      socket.off('user_joined_call');
    };
  }, []);

  const handleJoinGroup = (groupId: string) => {
    if (!isAfterDark) return alert('Zenvy After Dark opens at 9:00 PM!');
    setActiveGroup(groupId);
    setMessages([]);
    socket.emit('join_after_dark_group', { groupId });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeGroup) return;

    socket.emit('send_after_dark_message', {
      groupId: activeGroup,
      text: inputText,
      senderName: 'Anonymous Student' // In a real app, pull from User Context
    });
    
    setInputText('');
  };

  const toggleCall = () => {
    if (!activeGroup) return;
    if (inCall) {
      socket.emit('leave_after_dark_call', { groupId: activeGroup });
      setInCall(false);
    } else {
      socket.emit('join_after_dark_call', { groupId: activeGroup });
      setInCall(true);
    }
  };

  // If it's not After Dark, we can show a countdown or a sleeping moon
  if (!isAfterDark) {
    return (
      <div className="w-full max-w-4xl mx-auto my-8 p-6 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/20 rounded-2xl flex flex-col items-center justify-center text-center">
        <Moon className="w-12 h-12 text-indigo-400 mb-4 animate-pulse" />
        <h2 className="text-2xl font-bold text-white mb-2">Zenvy After Dark is Sleeping</h2>
        <p className="text-indigo-200">The Campus Lounge opens exactly at 9:00 PM. See you tonight.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto my-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 rounded-t-2xl p-4 flex items-center justify-between shadow-lg border border-purple-500/30">
        <div className="flex items-center gap-3">
          <Moon className="w-8 h-8 text-yellow-400" />
          <div>
            <h2 className="text-xl font-black text-white tracking-widest uppercase">Zenvy After Dark</h2>
            <p className="text-xs text-purple-200 font-medium">Campus Lounge is Live</p>
          </div>
        </div>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full text-white text-sm font-bold transition-all"
        >
          {isOpen ? 'Close Lounge' : 'Enter Lounge'}
        </button>
      </div>

      {/* Main Interface */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-[#12121A] border border-t-0 border-purple-500/30 rounded-b-2xl overflow-hidden flex flex-col md:flex-row h-[500px]"
          >
            {/* Sidebar: Groups */}
            <div className="w-full md:w-1/3 border-r border-white/5 p-4 flex flex-col overflow-y-auto bg-black/20">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Active Hubs</h3>
              {groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => handleJoinGroup(group.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl mb-2 transition-all text-left ${activeGroup === group.id ? 'bg-purple-600 text-white' : 'hover:bg-white/5 text-gray-300'}`}
                >
                  <Users className="w-5 h-5 opacity-70" />
                  <span className="font-semibold text-sm truncate">{group.name}</span>
                </button>
              ))}
            </div>

            {/* Chat Area */}
            <div className="w-full md:w-2/3 flex flex-col relative bg-black/40">
              {activeGroup ? (
                <>
                  {/* Chat Header */}
                  <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5 backdrop-blur-md z-10">
                    <span className="font-bold text-white">{groups.find(g => g.id === activeGroup)?.name}</span>
                    <button 
                      onClick={toggleCall}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${inCall ? 'bg-red-500 text-white animate-pulse' : 'bg-green-500/20 text-green-400 hover:bg-green-500/40'}`}
                    >
                      <Phone className="w-4 h-4" />
                      {inCall ? 'Leave Call' : 'Join Voice (Max 20)'}
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.senderId === 'me' ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-gray-500 mb-1 ml-1">{msg.senderName}</span>
                        <div className={`px-4 py-2 rounded-2xl max-w-[80%] text-sm ${msg.senderId === 'me' ? 'bg-purple-600 text-white rounded-br-none' : 'bg-white/10 text-gray-200 rounded-bl-none'}`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input Form */}
                  <form onSubmit={handleSendMessage} className="p-3 border-t border-white/5 bg-black/60">
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Say something to the group..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                      />
                      <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white p-2 rounded-full flex items-center justify-center transition-all">
                        <Send className="w-5 h-5" />
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                  <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
                  <p>Select a campus hub to start chatting</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
