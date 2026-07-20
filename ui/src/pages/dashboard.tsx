import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInbox } from '../hooks/use-chat-inbox.js';
import { useStaffSocket } from '../hooks/use-staff-socket.js';
import { getStaffSocket } from '../services/socket.js';
import { useChatsStore } from '../store/chats.js';

/**
 * Dashboard page — visitor list (left), active chat pane (right).
 * @returns The dashboard element.
 */
export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation();
  useStaffSocket();
  const { selectChat } = useChatInbox();
  const visitors = useChatsStore((s) => s.visitors);
  const chats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeChatId);

  const activeChat = activeChatId === null ? null : (chats[activeChatId] ?? null);
  const visitorList = Object.values(visitors);
  const chatList = Object.values(chats);

  return (
    <Stack spacing={3}>
      <Typography component="h2" variant="h4">
        {t('dashboard.heading')}
      </Typography>
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
                <ListItemButton key={v.visitorSessionId}>
                  <ListItemText
                    primary={v.visitorSessionId.slice(0, 8)}
                    secondary={v.currentUrl ?? ''}
                  />
                </ListItemButton>
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

/**
 * Right-hand panel showing the active chat's transcript + compose box.
 * @param props - ChatPane props.
 * @returns The pane element.
 */
function ChatPane(props: ChatPaneProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const chat = props.chat;

  const send = (): void => {
    if (chat === null || draft.trim() === '') return;
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
            setDraft(e.target.value);
          }}
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
