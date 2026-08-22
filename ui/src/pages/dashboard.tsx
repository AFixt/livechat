import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectionBanner } from '../components/connection-banner.js';
import { useChatInbox } from '../hooks/use-chat-inbox.js';
import { useStaffSocket } from '../hooks/use-staff-socket.js';
import { getStaffSocket } from '../services/socket.js';
import { revokeVisitorSession } from '../services/visitors-api.js';
import { useChatsStore } from '../store/chats.js';

/**
 * Dashboard page — visitor list (left), active chat pane (right).
 * @returns The dashboard element.
 */
export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  useStaffSocket();
  const { selectChat, initiateChatWithVisitor } = useChatInbox();
  const visitors = useChatsStore((s) => s.visitors);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);

  const removeVisitor = useChatsStore((s) => s.removeVisitor);
  const [status, setStatus] = useState('');

  const activeChat = activeChatId === null ? null : (chats[activeChatId] ?? null);
  const visitorList = Object.values(visitors);
  const chatList = Object.values(chats);

  /**
   * Revoke a visitor's session (#123). The server hard-deletes the row and
   * closes the visitor's socket; the row is dropped locally too rather than
   * waiting for the `visitor:left` event, so the list never shows a session
   * that no longer exists.
   * @param visitorSessionId - The visitor session to revoke.
   */
  const revoke = (visitorSessionId: string): void => {
    const id = visitorSessionId.slice(0, 8);
    void revokeVisitorSession(visitorSessionId)
      .then(() => {
        removeVisitor(visitorSessionId);
        setStatus(t('dashboard.visitors.revoked', { id }));
      })
      .catch(() => {
        setStatus(t('dashboard.visitors.revokeFailed', { id }));
      });
  };

  return (
    <Stack spacing={3}>
      <ConnectionBanner />
      <Typography component="h2" variant="h4">
        {t('dashboard.heading')}
      </Typography>
      {/* Revoking removes a row from the list, so the outcome has to be
          announced — the visual change alone is not perceivable to a screen
          reader user who was focused on that row (requirements.md §3). Named,
          because ConnectionBanner is also a `status` region and the two are
          otherwise indistinguishable. */}
      <Box
        role="status"
        aria-live="polite"
        aria-label={t('dashboard.visitors.statusRegion')}
        sx={visuallyHidden}
      >
        {status}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '320px 1fr' },
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography component="h3" variant="h6">
            {t('dashboard.visitors.heading')}
          </Typography>
          {visitorList.length === 0 ? (
            <Typography component="p" color="text.secondary">
              {t('dashboard.visitors.empty')}
            </Typography>
          ) : (
            <List aria-label={t('dashboard.visitors.heading')}>
              {visitorList.map((v) => (
                // `secondaryAction` renders the revoke button as a SIBLING of
                // the row button, not inside it. Nesting a button within a
                // button is invalid and leaves the inner control unreachable
                // for keyboard and AT users.
                <ListItem
                  key={v.visitorSessionId}
                  disablePadding
                  secondaryAction={
                    <Button
                      size="small"
                      color="warning"
                      aria-label={t('dashboard.visitors.revokeLabel', {
                        id: v.visitorSessionId.slice(0, 8),
                      })}
                      onClick={() => {
                        revoke(v.visitorSessionId);
                      }}
                    >
                      {t('dashboard.visitors.revoke')}
                    </Button>
                  }
                >
                  <ListItemButton
                    aria-label={t('dashboard.visitors.startChat', {
                      id: v.visitorSessionId.slice(0, 8),
                    })}
                    onClick={() => {
                      initiateChatWithVisitor(v.visitorSessionId);
                    }}
                  >
                    <ListItemText
                      primary={v.visitorSessionId.slice(0, 8)}
                      secondary={v.currentUrl ?? ''}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
          <Divider sx={{ my: 2 }} />
          <Typography component="h3" variant="h6">
            {t('dashboard.chats.heading')}
          </Typography>
          {chatList.length === 0 ? (
            <Typography component="p" color="text.secondary">
              {t('dashboard.chats.empty')}
            </Typography>
          ) : (
            <List aria-label={t('dashboard.chats.heading')}>
              {chatList.map((c) => (
                <ListItemButton
                  key={c.id}
                  selected={c.id === activeChatId}
                  onClick={() => {
                    selectChat(c.id);
                  }}
                >
                  <ListItemText primary={c.customerName ?? c.id.slice(0, 8)} secondary={c.status} />
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>
        <ChatPane chat={activeChat} />
      </Box>
    </Stack>
  );
}

interface ChatPaneProps {
  chat: {
    id: string;
    customerName: string | null;
    status: string;
    messages: {
      id: string;
      body: string;
      senderKind: 'visitor' | 'user' | 'system';
      deliveredAt: string;
    }[];
  } | null;
}

/** How long after the last keystroke the operator is considered to have stopped. */
const TYPING_IDLE_MS = 1500;

/**
 * Right-hand panel showing the active chat's transcript + compose box.
 * @param props - ChatPane props.
 * @returns The pane element.
 */
function ChatPane(props: ChatPaneProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const chat = props.chat;
  const visitorTyping = useChatsStore((s) => (chat === null ? false : s.typingByChat[chat.id]));
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalling = useRef(false);

  const stopTyping = (): void => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (signalling.current && chat !== null) {
      signalling.current = false;
      getStaffSocket().emit('chat:typing', { chatId: chat.id, isTyping: false });
    }
  };

  const onDraftChange = (value: string): void => {
    setDraft(value);
    if (chat === null) return;
    if (value.trim() === '') {
      stopTyping();
      return;
    }
    if (!signalling.current) {
      signalling.current = true;
      getStaffSocket().emit('chat:typing', { chatId: chat.id, isTyping: true });
    }
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const send = (): void => {
    if (chat === null || draft.trim() === '') return;
    stopTyping();
    getStaffSocket().emit('chat:message', { chatId: chat.id, body: draft });
    setDraft('');
  };

  const endChat = (): void => {
    if (chat === null) return;
    getStaffSocket().emit('chat:end', { chatId: chat.id });
  };

  if (chat === null) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography component="p" color="text.secondary">
          {t('dashboard.chats.noSelection')}
        </Typography>
      </Paper>
    );
  }

  const chatEnded = chat.status.startsWith('ended_');

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box component="header" sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography component="h3" variant="h6">
          {chat.customerName ?? chat.id.slice(0, 8)}
        </Typography>
        <Button onClick={endChat} disabled={chatEnded} color="warning">
          {t('dashboard.chats.end')}
        </Button>
      </Box>
      <Box
        component="ol"
        aria-label="Chat transcript"
        role="log"
        aria-live="polite"
        sx={{
          flexGrow: 1,
          minHeight: 240,
          maxHeight: 480,
          overflowY: 'auto',
          listStyle: 'none',
          m: 0,
          p: 0,
        }}
      >
        {chat.messages.map((m) => (
          <Box
            key={m.id}
            component="li"
            sx={{
              mb: 1,
              textAlign: m.senderKind === 'user' ? 'right' : 'left',
            }}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                px: 1.5,
                py: 0.75,
                borderRadius: 2,
                bgcolor: m.senderKind === 'user' ? 'primary.main' : 'action.hover',
                color: m.senderKind === 'user' ? 'primary.contrastText' : 'text.primary',
              }}
            >
              {m.body}
            </Box>
          </Box>
        ))}
      </Box>
      <Typography
        component="p"
        variant="body2"
        color="text.secondary"
        role="status"
        aria-live="polite"
        sx={{ minHeight: 20 }}
      >
        {visitorTyping === true
          ? t('dashboard.chats.typing', { name: chat.customerName ?? chat.id.slice(0, 8) })
          : ''}
      </Typography>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          label={t('dashboard.chats.messageLabel')}
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value);
          }}
          onBlur={stopTyping}
          disabled={chatEnded}
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={chatEnded || draft.trim() === ''}>
          {t('dashboard.chats.send')}
        </Button>
      </Box>
    </Paper>
  );
}

export default DashboardPage;
