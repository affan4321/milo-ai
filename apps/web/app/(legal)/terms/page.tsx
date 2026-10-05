import Link from "next/link";
import { LegalDoc, Mail, OPERATOR } from "../legal";

export const metadata = { title: "Terms of Service · Milo.ai", description: "The agreement between you and Milo.ai when you use the service." };

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service"
      intro={<p>These terms are an agreement between you and {OPERATOR}, who operates Milo.ai (&ldquo;Milo&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By signing in to or using Milo you agree to them. If you use Milo for an organization, you agree on its behalf and confirm you are allowed to.</p>}
      sections={[
        { id: "service", title: "What Milo does", body: <p>Milo joins online meetings you choose, or takes recordings you upload, and produces a recording, a transcript, summaries, action items and related notes. It also lets you search, ask questions about, clip and share that content.</p> },
        { id: "account", title: "Your account", body: <>
          <p>You sign in with a Google or Microsoft account. You are responsible for activity under your account and for keeping that account secure. You must be at least 16 and able to enter into this agreement.</p>
          <p>Tell us at <Mail /> if you believe someone else has accessed your account.</p>
        </> },
        { id: "consent", title: "Recording and consent", body: <>
          <p><strong>You are responsible for making sure recording is lawful.</strong> Laws about recording conversations differ by place, and many require every participant to agree. Before Milo records a meeting, you must have whatever notice and consent the law requires from everyone in it.</p>
          <p>Milo helps by joining as a visible participant and, unless you turn it off, announcing in the meeting chat that the call is being recorded. That announcement does not replace your own obligation. If you turn it off, you must tell attendees another way.</p>
          <p>Do not send Milo to a meeting you are not entitled to attend or record.</p>
        </> },
        { id: "content", title: "Your content", body: <>
          <p>Your recordings, transcripts, notes and anything else you put into Milo remain yours. You give us permission to store, process and display that content only as needed to run the service for you, including sending it to the providers described in the <Link href="/privacy">Privacy Policy</Link>.</p>
          <p>You confirm you have the rights and permissions needed for the content you record or upload, and for sharing it with teammates, attendees or by public link.</p>
        </> },
        { id: "use", title: "Acceptable use", body: <>
          <p>You agree not to:</p>
          <ul>
            <li>record people secretly or in breach of the law, or use Milo to harass or surveil anyone;</li>
            <li>upload content that is unlawful or that infringes someone else&apos;s rights;</li>
            <li>try to access other people&apos;s meetings or accounts, or probe, disrupt or overload the service;</li>
            <li>resell Milo or use it to build a competing product without our written agreement.</li>
          </ul>
        </> },
        { id: "ai", title: "AI-generated output", body: <p>Transcripts, summaries, action items and answers are generated automatically and can contain mistakes, omissions or misattributed speakers. Check anything important against the recording. Do not rely on Milo&apos;s output as legal, medical, financial or other professional advice.</p> },
        { id: "third", title: "Third-party services", body: <p>Milo works with services we do not control, such as Google Meet, Zoom, Microsoft Teams and your calendar provider. Your use of them is subject to their terms, and Milo may stop working with one if that service changes or restricts access.</p> },
        { id: "availability", title: "Availability and changes", body: <p>We work to keep Milo running but do not promise it will always be available or that a meeting will always be recorded. For example, a host may not admit Milo to the call. We may change, limit or discontinue features, and will try to give notice of significant changes.</p> },
        { id: "termination", title: "Ending your use", body: <>
          <p>You can stop using Milo at any time and ask us to delete your account and content at <Mail />.</p>
          <p>We may suspend or close an account that breaks these terms or puts the service or other people at risk. Where reasonable we will warn you first and give you a chance to retrieve your content.</p>
        </> },
        { id: "warranty", title: "No warranties", body: <p>Milo is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law allows, we make no warranties of any kind, including that the service will be uninterrupted, error-free, or that its output will be accurate or fit for a particular purpose.</p> },
        { id: "liability", title: "Limit of liability", body: <p>To the extent the law allows, we are not liable for indirect, incidental or consequential losses, or for lost profits, data or goodwill, arising from your use of Milo. Our total liability for any claim is limited to the amount you paid us for Milo in the twelve months before the claim, or USD 100 if you paid nothing. Nothing in these terms limits liability that cannot legally be limited.</p> },
        { id: "indemnity", title: "Your responsibility for claims", body: <p>If someone brings a claim against us because you recorded or shared a meeting without the required consent, or otherwise broke these terms or the law, you agree to cover our reasonable costs and losses from that claim.</p> },
        { id: "changes", title: "Changes to these terms", body: <p>We may update these terms. We will change the effective date above and, for significant changes, tell you by email or in the app before they apply. Continuing to use Milo afterwards means you accept the new terms.</p> },
        { id: "law", title: "Governing law", body: <p>These terms are governed by the laws of Pakistan, and the courts of Pakistan have jurisdiction over disputes about them. This does not take away consumer protections you are entitled to under the law of the country where you live.</p> },
        { id: "contact", title: "Contact", body: <p>Questions about these terms: <Mail />. See also our <Link href="/privacy">Privacy Policy</Link>.</p> },
      ]} />
  );
}
