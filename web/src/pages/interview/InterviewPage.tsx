import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { CandidateInfo, InterviewState, InterviewSpeaker, TranscriptTurn } from "@/types";
import ConnectionStatus from "@/components/interview/ConnectionStatus";
import TranscriptBubble from "@/components/interview/TranscriptBubble";
import InterviewTimer from "@/components/interview/InterviewTimer";
import { useAudioWebSocket } from "@/hooks/useAudioWebSocket";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import VoiceBars from "@/components/interview/VoiceBars";
import { CheckCircle, Mic, MicOff } from "lucide-react";
import HardwareCheck from "@/components/HardwareCheck";
import { sessionsApi } from "@/services/sessions";

export default function InterviewPage() {
  const { token } = useParams<{ token: string }>();
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [interviewState, setInterviewState] = useState<InterviewState>("idle");
  const [speaker, setSpeaker] = useState<InterviewSpeaker>(null);
  const [transcript, setTranscript] = useState<Pick<TranscriptTurn, "speaker" | "text">[]>([]);
  const [hardwareCheckDone, setHardwareCheckDone] = useState(false); // kept for green banner
  const [connectionLostLong, setConnectionLostLong] = useState(false);
  const [reconnectedPrompt, setReconnectedPrompt] = useState(false);
  const reconnectedPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionLostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const micMutedRef = useRef(false);

  // Fetch candidate info
  useEffect(() => {
    if (!token) return;
    sessionsApi.getCandidateInfo(token)
      .then((res) => {
        setCandidateInfo(res.data);
        setSessionId(res.data.session_id);
        if (res.data.session_status === "ended") setInterviewState("complete");
      })
      .catch(() => setInterviewState("complete"));
  }, [token]);

  const muteRef = useRef<(() => void) | null>(null);
  const unmuteRef = useRef<(() => void) | null>(null);

  const handleStateChange = useCallback((state: InterviewState) => {
    setInterviewState(state);

    if (state === "draining_audio") {
      // Mute mic, stop sending — wait for audio queue to drain then call audio_complete
      muteRef.current?.();
      audioCompleteCalledRef.current = false;
      // Safety timeout: call audio_complete after 10s even if drain never fires
      audioCompleteSafetyTimerRef.current = setTimeout(() => {
        callAudioComplete();
      }, 10_000);
      waitForDrain(() => callAudioComplete());
      return;
    }

    if (state === "reconnecting") {
      muteRef.current?.();
      connectionLostTimerRef.current = setTimeout(() => {
        setConnectionLostLong(true);
      }, 60_000);
    } else {
      if (connectionLostTimerRef.current) {
        clearTimeout(connectionLostTimerRef.current);
        connectionLostTimerRef.current = null;
      }
      setConnectionLostLong(false);
      if (state === "active" && !micMutedRef.current) unmuteRef.current?.();
    }
  }, []);

  const handleReconnected = useCallback(() => {
    if (reconnectedPromptTimerRef.current) clearTimeout(reconnectedPromptTimerRef.current);
    setReconnectedPrompt(true);
    reconnectedPromptTimerRef.current = setTimeout(() => setReconnectedPrompt(false), 10_000);
  }, []);

  const handleTranscript = useCallback((turn: Pick<TranscriptTurn, "speaker" | "text">) => {
    setTranscript((prev) => [...prev.slice(-9), turn]); // keep last 10
  }, []);

  const { playChunk, stop: stopPlayback, scheduleAfterPlayback, waitForDrain, cancelDrain } = useAudioPlayback();
  const audioCompleteCalledRef = useRef(false);
  const audioCompleteSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callAudioComplete = useCallback(async () => {
    if (audioCompleteCalledRef.current || !token) return;
    audioCompleteCalledRef.current = true;
    cancelDrain();
    if (audioCompleteSafetyTimerRef.current) {
      clearTimeout(audioCompleteSafetyTimerRef.current);
      audioCompleteSafetyTimerRef.current = null;
    }
    // Retry until success — endpoint now always returns ended:true or an error.
    // ended:false is no longer a valid response; any success means the session ended.
    const attempt = async (delay: number) => {
      try {
        await sessionsApi.audioComplete(token);
      } catch {
        setTimeout(() => attempt(Math.min(delay * 2, 8000)), delay);
      }
    };
    attempt(2000);
  }, [token, cancelDrain]);

  const handleSpeakerChange = useCallback((newSpeaker: InterviewSpeaker) => {
    if (newSpeaker === "ai") {
      setSpeaker("ai");
      muteRef.current?.();
    } else if (newSpeaker === "candidate") {
      scheduleAfterPlayback(() => {
        setSpeaker("candidate");
        if (!micMutedRef.current) unmuteRef.current?.();
      });
    }
  }, [scheduleAfterPlayback]);

  const { connect, send, sendJson, disconnect, connectionState } = useAudioWebSocket({
    sessionId: sessionId ?? 0,
    token,
    onAudioChunk: playChunk,
    onTranscript: handleTranscript,
    onStateChange: handleStateChange,
    onSpeakerChange: handleSpeakerChange,
    onReconnected: handleReconnected,
  });

  const { start: startCapture, stop: stopCapture, mute, unmute } = useAudioCapture({
    onFrame: send,
  });

  muteRef.current = mute;
  unmuteRef.current = unmute;

  const toggleMic = useCallback(() => {
    if (micMutedRef.current) {
      micMutedRef.current = false;
      setMicMuted(false);
      unmute();
    } else {
      micMutedRef.current = true;
      setMicMuted(true);
      mute();
    }
  }, [mute, unmute]);

  const startInterview = useCallback(async () => {
    if (!sessionId) return;
    setInterviewState("connecting");
    connect();
    await startCapture();
    // Start muted — only unmute when backend sends speaker_changed: candidate.
    // This prevents mic audio from being sent during AI speech, since separate
    // AudioContexts for capture/playback break the browser's echo cancellation.
    muteRef.current?.();
  }, [sessionId, connect, startCapture]);

  const endInterview = useCallback(async () => {
    setInterviewState("ending");
    if (reconnectedPromptTimerRef.current) clearTimeout(reconnectedPromptTimerRef.current);
    stopCapture();
    stopPlayback();
    sendJson({ type: "end_session" });
    disconnect();
    setInterviewState("complete");
  }, [stopCapture, stopPlayback, sendJson, disconnect]);

  const wsConnectionStatus =
    interviewState === "reconnecting"
      ? connectionLostLong ? "lost" : "reconnecting"
      : connectionState === "connected"
        ? "connected"
        : "reconnecting";

  // ── State A: Pre-start ──────────────────────────────────────────────────
  if (interviewState === "idle") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100/50 flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-xl shadow-zinc-200/40 border border-zinc-100 p-8 sm:p-10 space-y-8 animate-in zoom-in-95 duration-500">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center mb-5 shadow-md">
              <Mic className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              {candidateInfo?.role_title ?? "AI Interview"}
            </h1>
            {candidateInfo && (
              <p className="text-sm font-medium text-zinc-500">
                {candidateInfo.time_limit_min} Minutes Session
              </p>
            )}
          </div>

          {!hardwareCheckDone ? (
            <div className="space-y-6">
              <div className="bg-zinc-50 rounded-2xl p-5 text-sm space-y-3 text-zinc-600 border border-zinc-100/50">
                <p className="flex items-start gap-2.5">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  This is a voice interview. Make sure you're in a quiet place.
                </p>
                <p className="flex items-start gap-2.5">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  The AI will ask follow-up questions — there are no scripts.
                </p>
                <p className="flex items-start gap-2.5">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  The session will last up to {candidateInfo?.time_limit_min ?? "—"} minutes.
                </p>
                <p className="flex items-start gap-2.5">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  Your mic will be active throughout. You can end anytime.
                </p>
              </div>
              <HardwareCheck onStart={() => { setHardwareCheckDone(true); startInterview(); }} />
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col items-center justify-center gap-3 text-sm text-emerald-700 bg-emerald-50/80 border border-emerald-100 rounded-2xl px-4 py-8 text-center">
                <CheckCircle className="h-10 w-10 text-emerald-500 mb-1" />
                <span className="font-medium text-base">Hardware checks passed.<br />You're ready to start.</span>
              </div>
              <Button className="w-full h-14 rounded-xl text-base font-medium shadow-lg shadow-zinc-200/50 transition-all hover:scale-[1.02]" onClick={startInterview}>
                <Mic className="h-5 w-5 mr-2" />
                Start Interview Now
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── State F: Complete ───────────────────────────────────────────────────
  if (interviewState === "complete") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-[2rem] p-10 text-center space-y-6 shadow-xl shadow-zinc-200/40 border border-zinc-100 animate-in zoom-in-95 duration-500">
          <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-sm border border-emerald-100">
            <CheckCircle className="h-10 w-10" />
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Interview Complete</h2>
            <p className="text-zinc-500 leading-relaxed text-sm">
              Thank you. The interview has been successfully recorded.<br /><br />
              The hiring team will review your results and follow up with you shortly. You may now close this window.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── States B/C/D/E: Active interview ────────────────────────────────────
  const aiSpeaking = speaker === "ai";
  const candidateSpeaking = speaker === "candidate";

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col font-sans relative overflow-hidden">

      {/* Decorative background blur */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Floating Header */}
      <header className="absolute top-0 w-full z-20 px-4 sm:px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white shadow-sm border border-zinc-200/60">
            <Mic className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <div className="font-semibold text-zinc-900 tracking-tight leading-none mb-1">AI Interview</div>
            <div className="text-xs font-medium text-zinc-500">{candidateInfo?.role_title}</div>
          </div>
        </div>

        {candidateInfo && (
          <div className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-full shadow-sm border border-zinc-200/60 flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", interviewState === "active" ? "bg-emerald-500 animate-pulse" : "bg-zinc-300")} />
            <InterviewTimer
              totalSeconds={candidateInfo.time_limit_min * 60}
              running={interviewState === "active"}
              onExpired={endInterview}
            />
          </div>
        )}
      </header>

      {/* Main Interview Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 px-4 pt-24 pb-32">
        <div className="w-full max-w-3xl flex flex-col items-center gap-10">

          {/* Notifications */}
          <div className="absolute top-24 w-full max-w-xl px-4 flex flex-col gap-2 z-30">
            {interviewState === "reconnecting" && (
              <div className="flex items-center gap-3 text-sm bg-white/90 backdrop-blur-md border shadow-lg rounded-xl px-5 py-3 animate-in slide-in-from-top-4">
                <span className={cn("animate-pulse w-3 h-3 rounded-full shrink-0", connectionLostLong ? "bg-red-500" : "bg-amber-500")} />
                <span className={cn("font-medium", connectionLostLong ? "text-red-700" : "text-amber-700")}>
                  {connectionLostLong ? "Connection is taking too long to restore. Please wait..." : "Briefly reconnecting — please wait a moment."}
                </span>
              </div>
            )}

            {reconnectedPrompt && (
              <div className="flex items-center justify-between text-sm bg-blue-500 text-white shadow-lg shadow-blue-500/20 rounded-xl px-5 py-3 animate-in slide-in-from-top-4">
                <span>Reconnected — please say <strong>"check"</strong> or continue your answer to resume.</span>
                <button className="ml-3 hover:text-blue-100 transition-colors shrink-0" onClick={() => setReconnectedPrompt(false)}>✕</button>
              </div>
            )}
          </div>

          {/* Core Visualizer */}
          <div className="flex flex-col items-center justify-center w-full min-h-[300px]">
            {interviewState === "connecting" ? (
              <div className="flex flex-col items-center gap-5">
                <div className="w-16 h-16 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin shadow-lg" />
                <div className="text-sm font-medium text-zinc-500 animate-pulse">Establishing secure connection...</div>
              </div>
            ) : interviewState === "draining_audio" ? (
              <div className="flex flex-col items-center gap-6 animate-out fade-out duration-1000">
                <div className="p-8 rounded-full bg-white shadow-xl shadow-zinc-200/50 border border-zinc-100">
                  <VoiceBars active={true} label="" variant="ai" />
                </div>
                <p className="text-sm font-medium text-zinc-500 bg-white px-5 py-2.5 rounded-full border border-zinc-200 shadow-sm">Wrapping up session...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full gap-8">
                {/* AI Orb / Visualizer */}
                <div className={cn(
                  "p-8 rounded-full transition-all duration-700",
                  aiSpeaking ? "bg-indigo-50 shadow-2xl shadow-indigo-500/20 border-indigo-100 scale-105" : "bg-white shadow-xl shadow-zinc-200/50 border-zinc-100 scale-100",
                  "border"
                )}>
                  <VoiceBars
                    active={aiSpeaking}
                    label={aiSpeaking ? "AI Speaking" : "Listening..."}
                    variant="ai"
                  />
                </div>

                {/* Candidate speaking indicator */}
                <div className={cn(
                  "transition-all duration-500",
                  candidateSpeaking ? "opacity-100 transform translate-y-0" : "opacity-0 transform translate-y-4 pointer-events-none"
                )}>
                  <div className="flex items-center gap-3 bg-zinc-900 text-white px-5 py-2.5 rounded-full shadow-lg">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-sm font-medium">You are speaking</span>
                  </div>
                </div>

                {/* Live Transcript */}
                {transcript.length > 0 && (
                  <div className="w-full max-w-2xl mt-4 space-y-3 overflow-y-auto max-h-[30vh] pr-2 scrollbar-thin scrollbar-thumb-zinc-200 mask-image-b">
                    {transcript.map((turn, i) => (
                      <TranscriptBubble key={i} speaker={turn.speaker} text={turn.text} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Floating Control Bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[92%] sm:w-[85%] max-w-2xl">
        <div className="bg-white/80 backdrop-blur-xl border border-zinc-200/60 shadow-2xl shadow-zinc-200/50 rounded-2xl p-2.5 flex items-center justify-between">
          <div className="pl-3 hidden sm:block">
            <ConnectionStatus state={wsConnectionStatus} />
          </div>

          <div className="pl-3 sm:hidden scale-90 origin-left">
            <ConnectionStatus state={wsConnectionStatus} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={micMuted ? "destructive" : "outline"}
              size="default"
              className={cn(
                "rounded-xl h-11 px-4 sm:px-6 transition-all font-medium",
                !micMuted && "hover:bg-zinc-100 border-zinc-200 shadow-sm"
              )}
              onClick={toggleMic}
            >
              {micMuted ? (
                <><MicOff className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Muted</span></>
              ) : (
                <><Mic className="h-4 w-4 sm:mr-2 text-emerald-600" /> <span className="hidden sm:inline">Mic On</span></>
              )}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="default" className="rounded-xl h-11 px-4 text-zinc-500 hover:text-red-600 hover:bg-red-50 font-medium">
                  End
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-[2rem] border-zinc-100 shadow-2xl p-8 max-w-md">
                <AlertDialogHeader className="space-y-3">
                  <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-2">
                    <MicOff className="h-6 w-6" />
                  </div>
                  <AlertDialogTitle className="text-xl text-center">End Interview?</AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-500 text-center text-base">
                    Are you sure you want to end the interview early? All your answers so far have been saved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-8 flex-col sm:flex-row gap-3">
                  <AlertDialogCancel className="rounded-xl h-12 w-full sm:w-1/2 m-0">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={endInterview} className="rounded-xl h-12 w-full sm:w-1/2 bg-red-600 hover:bg-red-700 text-white m-0">
                    Yes, End Interview
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {import.meta.env.DEV && (
              <Button variant="outline" size="icon" className="h-11 w-11 rounded-xl text-zinc-400 hover:text-zinc-900 border-dashed"
                onClick={() => sendJson({ type: "debug_force_reconnect" })} title="Force reconnect">
                ⚡
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
