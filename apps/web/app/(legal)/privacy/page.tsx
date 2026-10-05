import Link from "next/link";
import { LegalDoc, Mail, OPERATOR } from "../legal";

export const metadata = { title: "Privacy Policy · Milo.ai", description: "What Milo.ai collects, why, who it is shared with, and how to have it deleted." };

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy"
      intro={<>
        <p>Milo.ai (&ldquo;Milo&rdquo;) is an AI meeting notetaker operated by {OPERATOR} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what information Milo handles when you use it, what we do with it, and the choices you have.</p>
        <p>The short version: Milo records the meetings you ask it to, turns them into transcripts and notes for you, and keeps them private to you unless you share them. We do not sell your information and we do not show ads.</p>
      </>}
      sections={[
        { id: "collect", title: "Information we collect", body: <>
          <p><strong>Account details.</strong> When you sign in with Google or Microsoft we receive your name, email address and profile picture. We never see your password.</p>
          <p><strong>Calendar events.</strong> With your permission, Milo reads your calendar (read-only) or an iCal address you paste in. We store upcoming events&apos; titles, times, meeting links and attendee information so Milo knows which meetings to join. Milo cannot create, change or delete calendar events.</p>
          <p><strong>Meeting content.</strong> For meetings Milo joins or recordings you upload, we store the audio or video recording, the transcript, speaker names and talk time, the chat messages and participant list seen during the call, and what Milo produces from them: summaries, action items, chapters, highlights and clips.</p>
          <p><strong>What you create in Milo.</strong> Your settings, summary templates, playlists, keyword alerts, and the questions you ask in Ask Milo together with the answers.</p>
          <p><strong>Shared clip activity.</strong> When someone opens a public clip link we count the view. We do not identify who viewed it.</p>
          <p><strong>Technical data.</strong> Our hosting providers keep standard server logs (such as IP address and browser type) to run and secure the service.</p>
        </> },
        { id: "others", title: "Other people in your meetings", body: <>
          <p>Recordings include the voices, names and words of everyone in the call, not only the person who invited Milo. Milo joins as a visible participant named &ldquo;Milo AI Notetaker&rdquo; and, unless the account owner turns it off, posts a message in the meeting chat saying the call is being recorded.</p>
          <p>The person who brings Milo to a meeting is responsible for getting any consent the law requires. If you were recorded in a meeting and want that recording removed, ask the meeting&apos;s organizer or write to us at <Mail />.</p>
        </> },
        { id: "use", title: "How we use information", body: <ul>
          <li>To join, record and transcribe the meetings you choose.</li>
          <li>To write summaries, action items and chapters, and to answer your searches and Ask Milo questions.</li>
          <li>To email you recaps and keyword alerts, and to email recaps to attendees when you have chosen that.</li>
          <li>To keep the service working, fix problems and prevent abuse.</li>
        </ul> },
        { id: "ai", title: "AI processing", body: <>
          <p>Transcripts, summaries, search and answers are produced by AI models. To do this, Milo sends meeting audio and transcript text to speech-to-text and language-model providers (see the next section). We do not use your meeting content to train our own models.</p>
          <p>AI output can be wrong or incomplete. Summaries and answers link back to the moment in the recording so you can check them.</p>
        </> },
        { id: "sharing", title: "Who we share information with", body: <>
          <p>We do not sell your information. We share it only as follows:</p>
          <ul>
            <li><strong>Service providers</strong> that process data on our behalf: Vercel (web hosting), Neon (database), an S3-compatible cloud storage provider (recordings and clips), Google Gemini, Deepgram and Groq (transcription and language models), and an email delivery provider. Each handles data under its own terms, which can vary by plan.</li>
            <li><strong>Your teammates</strong>, for meetings you mark as shared with your team.</li>
            <li><strong>Meeting attendees</strong>, who receive recap emails if you have turned that on.</li>
            <li><strong>Anyone with a public clip link</strong> you create. You can turn a link off at any time.</li>
            <li><strong>Authorities</strong>, when the law requires it.</li>
          </ul>
        </> },
        { id: "google", title: "Google user data", body: <>
          <p>Milo&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
          <p>Milo requests your basic profile and read-only access to your calendar. Calendar data is used only to show your upcoming meetings and decide which ones Milo should join. It is not used for advertising, is not sold, and is not used to train AI models.</p>
        </> },
        { id: "storage", title: "Storage and security", body: <>
          <p>Recordings and clips are kept in a private storage bucket and played through short-lived signed links. Meetings are visible only to their owner unless shared. Public clip links are long, random and revocable. Connections to Milo are encrypted in transit.</p>
          <p>No system is perfectly secure. If we learn of a breach affecting your information we will tell you.</p>
        </> },
        { id: "retention", title: "How long we keep it", body: <p>We keep your account and meeting content until you ask us to delete it. When you do, we delete it from our systems within 30 days, apart from copies in routine backups, which expire on their own, and anything we are legally required to keep.</p> },
        { id: "choices", title: "Your choices and rights", body: <>
          <ul>
            <li>Choose which meetings Milo records, per meeting or by rule, under <Link href="/customize">Recording rules</Link>.</li>
            <li>Keep meetings private or share them, and turn public clip links off.</li>
            <li>Disconnect a calendar and turn emails off in <Link href="/settings">Settings</Link>. You can also remove Milo&apos;s access from your Google or Microsoft account&apos;s security page.</li>
            <li>Ask for a copy of your information, a correction, or deletion of a meeting or your whole account by emailing <Mail />.</li>
          </ul>
          <p>Depending on where you live you may have further rights under local law, such as objecting to certain processing or complaining to a data protection authority. Write to us and we will help.</p>
        </> },
        { id: "cookies", title: "Cookies", body: <p>Milo uses a sign-in cookie to keep you logged in and stores your light or dark theme preference in your browser. We do not use advertising or analytics cookies.</p> },
        { id: "children", title: "Children", body: <p>Milo is not intended for anyone under 16, and we do not knowingly collect their information.</p> },
        { id: "international", title: "International transfers", body: <p>Our providers may store and process information in countries other than yours, including the United States. By using Milo you understand your information may be transferred there.</p> },
        { id: "changes", title: "Changes to this policy", body: <p>If we change this policy we will update the effective date above, and for significant changes we will tell you by email or in the app before they apply.</p> },
        { id: "contact", title: "Contact", body: <p>Questions or requests about your information: <Mail />. See also our <Link href="/terms">Terms of Service</Link>.</p> },
      ]} />
  );
}
