using System;
using System.Collections.Generic;

namespace HomeChat.GameBar
{
    public sealed class User
    {
        public int Id { get; set; }
        public string Hid { get; set; }
        public string DisplayName { get; set; }
        public string AvatarUrl { get; set; }
        public bool IsAdmin { get; set; }
    }

    public sealed class LoginResponse
    {
        public string Token { get; set; }
        public User User { get; set; }
    }

    public sealed class Conversation
    {
        public int Id { get; set; }
        public string Type { get; set; }
        public bool IsSelf { get; set; }
        public string Name { get; set; }
        public string AvatarUrl { get; set; }
        public List<User> Members { get; set; } = new List<User>();
        public int UnreadCount { get; set; }
        public int MentionCount { get; set; }
        public Message LastMessage { get; set; }

        public string DisplayNameFor(int currentUserId)
        {
            if (IsSelf) return "Saved Messages";
            if (string.Equals(Type, "group", StringComparison.OrdinalIgnoreCase))
                return string.IsNullOrWhiteSpace(Name) ? "Group" : Name;

            foreach (var member in Members)
                if (member.Id != currentUserId)
                    return member.DisplayName;

            return string.IsNullOrWhiteSpace(Name) ? "Conversation" : Name;
        }

        public string BadgeText
        {
            get
            {
                if (MentionCount > 0) return "@" + MentionCount;
                return UnreadCount > 0 ? UnreadCount.ToString() : string.Empty;
            }
        }
    }

    public sealed class Message
    {
        public int Id { get; set; }
        public int ConversationId { get; set; }
        public User Sender { get; set; }
        public string Type { get; set; }
        public string Body { get; set; }
        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? EditedAt { get; set; }
        public DateTimeOffset? DeletedAt { get; set; }

        public string DisplayBody
        {
            get
            {
                if (DeletedAt.HasValue) return "Message deleted";
                if (!string.IsNullOrWhiteSpace(Body)) return Body;
                if (Type == "image") return "Photo";
                if (Type == "file") return "Attachment";
                return "Message";
            }
        }

        public string TimeText => CreatedAt.ToLocalTime().ToString("h:mm tt");
    }
}
