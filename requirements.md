# Live Chat Support Software Requirements

## 1. Introduction

This document describes the requirements for a live chat support system that can
be added to any arbitrary website. This document is written in accordance with
[RFC2119](https://www.ietf.org/rfc/rfc2119.txt) "Key words for use in RFCs to
Indicate Requirement Levels".

### 1.1. Definitions

- Customer - TBD
- Support / Support Staff - TBD
- Client - TBD

## 2. Purpose

The purpose for this software will be to enable live chat conversations between
a user currently browsing (a customer) a website and an agent representing the
website's owner (support staff).

The business case for this software is to engage with customers and potential
customers as they browse the site. Existing customers will be able to use this
system to get support in real time. Potential customers can get sales support
and assistance in selecting the product(s) and service(s) that are right for
them.

## 3. Functional Requirements

Must provide chat capability — that is, the ability for two persons to interact
with the same system to exchange messages with one another in real-time.

Must provide alerts to customers and support staff when new messages arrive. The
alerts must be programmatic, visible, and audible.

Must allow detection of new customer on the site. When detected, the customer
will be listed in the support interface with as much identifiable information as
can be detected from the customer's browser and session information. This would
include such things as:

- Common user-agent information such as operating system, browser brand, and
  browser version
- Demographic information such as country, city, and language of the customer
- Session information such as length of time on the site, current location on
  the site

Must allow support staff to initiate chat sessions with the customer.

Must set relevant cookies to identify and track customers and customer chat
history. This would include such things as date(s) and time(s) of prior chat
activity.

History must be stored and persisted.

Must allow customer to initiate chat.

Must allow for authentication on support-facing side that will authenticate the
support staff. This authentication mechanism should facilitate single sign-on
from other systems as well.

Must allow some token that can be passed in customer-facing side that will allow
identification of a customer record in the site owner's system(s).

## 4. Technical Requirements

### 4.1. Core Requirements

- Accessible: The front-end interface on both the customer side and support side
  must be accessible. This is a core differentiator of the product.
- Secure: The system must provide for a high level of security of both the
  client and the customer.
- Performant: The system must be developed in such a way that it performs
  quickly both for the customer and the support staff.
- Flexible: While MVP does not include such integrations, it must be developed
  in a way that will facilitate future integrations into systems such as
  Salesforce, Desk.com, ZenDesk, Fresh Desk, etc.

### 4.2. Front-end dependencies

The customer-facing portion(s) of the system should avoid unnecessary bloat.
Requirements for front-end dependencies will be driven by the core requirements
listed above.

### 4.3. Server-side stack

At the moment, the server-side stack is yet to be determined. Due to the
event-based real-time communication between the customer and support staff, plus
other requirements listed in this document, it is likely that the best stack on
the server-side will be to run WebSockets with NodeJS and a NoSQL database like
MongoDB.

## 5. User Interface / User Interaction Requirements

The user interface on both the customer and support chats must be accessible.

Must facilitate customization by the client in terms of colors and iconography.

### 5.1. Customer-side Chat Interface

The customer chat interface will have the following states:

#### 5.1.1. Initial, uninitiated chat state

This state is the default state of the widget.

In this state, the chat widget is shown on the customer-facing pages of the
client website. A call-to-action exists, inviting the user to chat with support
staff.

#### 5.1.2. Chat invitation state

This state becomes available only if there is a support person logged-in and
available.

In this state, the chat widget changes its appearance (such as location and
size) and provides a call-to-action for the customer to initiate a chat after a
short period.

#### 5.1.3. Customer-initiated state

The customer can enable this state at any time.

In this state, the customer has activated the call-to-action and, in doing so,
is presented with a form to enter their name and type in their initial message.

#### 5.1.4. Customer-initiated, no support available state

This state is triggered after the user enters their initial message and the
system determines that there is no support staff available.

In this state, the widget prompts the customer to enter their email address to
email their request to support staff. The widget also provides other contact
information, such as support hours and a telephone number that the customer can
use to contact the client.

#### 5.1.5. Support-initiated state

This state can be triggered at any time by support staff. As described below,
the support interface provides a list of customers currently on the site. The
support person can pick from that list of customers and choose to initiate a
chat with one of them.

In this state, the action on the support side triggers a visible alert on the
customer's side that presents a call-to-action for the customer to respond to
indicate whether they'd like to engage with the support staff. The customer can
choose to respond to the chat request or to dismiss the notice.

#### 5.1.6. Actively chatting state

This state is triggered whenever a chat is initiated — and responded to — by
either the customer or support staff.

In this state, the support staff and customer exchange chat messages. As either
user enters a message it appears in the chat screen of both parties.

Example: <http://output.jsbin.com/pedavo/>

##### Note — Chat persistence

At any time, customers can choose to minimize or close the chat window. They can
also navigate away from the current page. None of these activities end the chat
session.

#### 5.1.7. Chat completed state — Support initiated

This state is triggered whenever a support person actively ends the session.
Typically this would be after the support person has asked the customer whether
their needs have been met sufficiently and if they needed any more assistance.

In this state, the chat is replaced with a message inviting the customer to get
an email of the chat log for their records.

- If they respond in the affirmative, they're prompted to supply an email
  address and, upon submitting the form, the chat log is sent to them, and the
  widget returns to its initial state.
- If they respond in the negative, the widget returns to its initial state.

#### 5.1.8. Restart Chat

This state is triggered whenever a customer re-opens a chat.

The use case for this state is when a user has either explicitly or accidentally
closed the chat widget but they're still in the same session (in other words,
they've never left the site or otherwise ended their session). They're still
browsing the site but they've closed / lost the chat window.

Visually the chat widget has gone back to its default state; however they can
re-open the chat window at any time to continue the conversation. New messages
sent by support staff will flash a notification to the user that a new message
has arrived.

### 5.2. Support-side Chat Interface

The support-side chat interactivity is much simpler.

- It must show all real-time users on the site
  - This must include the identifiable information listed elsewhere in this
    document.
  - It must also include the current URL being browsed by each user.
- It must support multiple chat sessions. Support staff may be required to
  interact with multiple individual users.
- It must allow for selection of chat session
  - This includes the ability to initiate a chat.
- It must provide alerts when new messages arrive
  - New messages cause chats to rise in the list.

Example: <http://output.jsbin.com/koroda/>

## 6. Implementation Requirements

### 6.1. Hosting & Deployment

Must be able to be built & deployed automatically with all dependencies.
Deployment scripts will perform automatic unit testing and will reject
deployment if unit tests fail.

### 6.2. Implementation of the customer-facing chat

Customer-facing chat must be able to be added to the site as a JS snippet that
client staff can add to any page of the site.
