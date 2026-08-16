import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ArrowLeft, Send, HelpCircle, MessageSquare } from 'lucide-react-native';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { colors, spacing, radius, typography } from '../theme';
import { useCrmStore, type InternalMessage } from '../stores/crmStore';
import { useAuthStore } from '../stores/authStore';

export interface ProjectChatScreenProps {
  projectId?: string;
  projectName?: string;
  onBack: () => void;
}

export function ProjectChatScreen({
  projectId = 'proj-1',
  projectName = 'Cocina Residencia Pérez',
  onBack,
}: ProjectChatScreenProps) {
  const [inputText, setInputText] = useState('');
  const [isTechnicalQuery, setIsTechnicalQuery] = useState(false);

  const user = useAuthStore((s) => s.user);
  const messages = useCrmStore((s) => s.getMessagesByProject(projectId));
  const sendMessage = useCrmStore((s) => s.sendMessage);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const content = inputText.trim();
    setInputText('');

    await sendMessage(
      projectId,
      content,
      user?.name || 'Taller',
      user?.role || 'produccion',
      isTechnicalQuery ? 'technical_query' : 'comment'
    );
    setIsTechnicalQuery(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Chat Técnico Contextual
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {projectName}
          </Text>
        </View>
      </View>

      {/* Messages Stream */}
      <ScrollView
        contentContainerStyle={styles.messagesContainer}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <Card style={styles.emptyCard}>
            <MessageSquare size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Sin Consultas</Text>
            <Text style={styles.emptySubtitle}>
              Inicia una conversación con la oficina técnica o reporta una duda sobre las medidas o despiece.
            </Text>
          </Card>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderName === (user?.name || 'Taller');
            const isQuery = msg.messageType === 'technical_query';

            return (
              <View
                key={msg.id}
                style={[
                  styles.messageBubble,
                  isMe ? styles.myMessage : styles.otherMessage,
                  isQuery ? styles.queryBubble : null,
                ]}
              >
                <View style={styles.messageHeader}>
                  <Text style={styles.senderName}>{msg.senderName}</Text>
                  {isQuery ? (
                    <Badge label="Duda Técnica" variant="warning" />
                  ) : (
                    <Badge label={msg.senderRole} variant="default" />
                  )}
                </View>
                <Text style={styles.messageContent}>{msg.content}</Text>
                <Text style={styles.messageTime}>
                  {new Date(msg.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Message Input Bar */}
      <View style={styles.inputBar}>
        <Pressable
          style={[
            styles.queryToggleBtn,
            isTechnicalQuery && styles.queryToggleActive,
          ]}
          onPress={() => setIsTechnicalQuery(!isTechnicalQuery)}
        >
          <HelpCircle
            size={18}
            color={isTechnicalQuery ? colors.warning : colors.textMuted}
          />
        </Pressable>

        <Input
          placeholder={
            isTechnicalQuery
              ? 'Escribe tu consulta técnica...'
              : 'Escribe un mensaje...'
          }
          value={inputText}
          onChangeText={setInputText}
          containerStyle={styles.inputFieldContainer}
          inputStyle={styles.inputField}
        />

        <Pressable
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Send size={18} color="#ffffff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  iconBtn: {
    padding: spacing.xs,
  },
  messagesContainer: {
    padding: spacing.md,
    flexGrow: 1,
  },
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 'auto',
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  emptySubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  messageBubble: {
    maxWidth: '85%',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceHover,
  },
  queryBubble: {
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: 4,
  },
  senderName: {
    ...typography.captionBold,
    color: colors.textPrimary,
  },
  messageContent: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  messageTime: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    alignSelf: 'flex-end',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  queryToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  queryToggleActive: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  inputFieldContainer: {
    flex: 1,
    marginBottom: 0,
  },
  inputField: {
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
