import type { BoardGraph } from './board';

export const EMAIL_DEMO: BoardGraph = {
  title: 'An email’s journey',
  description: 'From a thought in your outbox to a message in someone else’s inbox.',
  narration:
    'Let’s follow an email from the moment you write it to the moment it lands in someone else’s inbox.',
  suggestions: ['Show what happens if delivery fails'],
  nodes: [
    {
      id: 'sender',
      label: 'You write',
      icon: 'user',
      kind: 'step',
      summary: 'A message starts with you.',
      explanation:
        'You choose a recipient, write a subject and compose the message. The recipient’s address identifies a mailbox and its domain.',
      narration: 'It begins with you, writing a message and choosing who it’s for.',
    },
    {
      id: 'app',
      label: 'Email app',
      icon: 'mail',
      kind: 'step',
      summary: 'Your app submits the message.',
      explanation:
        'When you press Send, your app submits the message to your mail provider. Mail clients typically use authenticated SMTP; a webmail interface may use HTTPS to its provider.',
      narration: 'It can wait there as a draft for as long as you like.',
    },
    {
      id: 'outgoing',
      label: 'Sending server',
      icon: 'server',
      kind: 'step',
      summary: 'Your provider finds the destination.',
      explanation:
        'The sending server looks up the recipient domain’s MX records in DNS, then attempts to transfer the message to a receiving server using SMTP. Temporary failures can lead to queued retries.',
      narration: 'Your provider’s sending server looks up where the recipient’s mail should go.',
    },
    {
      id: 'incoming',
      label: 'Receiving server',
      icon: 'shield',
      kind: 'step',
      summary: 'The destination checks and accepts it.',
      explanation:
        'The receiving provider checks the address and applies authentication and spam checks. Accepted mail is routed to the appropriate mailbox, sometimes into a spam folder.',
      narration:
        'The receiving server checks the address, screens for spam and accepts the message.',
    },
    {
      id: 'recipient',
      label: 'Their inbox',
      icon: 'inbox',
      kind: 'step',
      summary: 'The recipient can read your message.',
      explanation:
        'The recipient’s app retrieves or synchronizes the mailbox through IMAP, a provider API or webmail. Delivery does not mean the message has been read.',
      narration: 'It’s now waiting in their inbox, ready for them to read.',
    },
  ],
  edges: [
    {
      id: 'compose',
      source: 'sender',
      target: 'app',
      label: 'Compose',
      narration: 'Once it’s written, the message sits in your email app.',
    },
    {
      id: 'submit',
      source: 'app',
      target: 'outgoing',
      label: 'Submit',
      narration: 'When you press send, the app submits it to your mail provider.',
    },
    {
      id: 'transfer',
      source: 'outgoing',
      target: 'incoming',
      label: 'SMTP',
      narration: 'The sending server then hands the message over to the recipient’s server.',
    },
    {
      id: 'deliver',
      source: 'incoming',
      target: 'recipient',
      label: 'Deliver',
      narration: 'Finally, the message is delivered to their mailbox.',
    },
  ],
};
