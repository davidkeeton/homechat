using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Gaming.XboxGameBar;
using Windows.Storage;
using Windows.System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Navigation;

namespace HomeChat.GameBar
{
    public sealed partial class HomeChatWidget : Page
    {
        private readonly HomeChatApi _api = new HomeChatApi();
        private readonly ObservableCollection<Conversation> _conversations = new ObservableCollection<Conversation>();
        private readonly ObservableCollection<Message> _messages = new ObservableCollection<Message>();
        private readonly DispatcherTimer _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        private XboxGameBarWidget _widget;
        private User _me;
        private Conversation _selected;
        private bool _refreshing;
        private int _conversationPollCounter;

        public HomeChatWidget()
        {
            InitializeComponent();
            ConversationList.ItemsSource = _conversations;
            MessageList.ItemsSource = _messages;
            _pollTimer.Tick += PollTimer_Tick;
            Loaded += HomeChatWidget_Loaded;
            Unloaded += HomeChatWidget_Unloaded;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            _widget = e.Parameter as XboxGameBarWidget;
            base.OnNavigatedTo(e);
        }

        private async void HomeChatWidget_Loaded(object sender, RoutedEventArgs e)
        {
            var settings = ApplicationData.Current.LocalSettings.Values;
            ServerBox.Text = settings["serverUrl"] as string ?? string.Empty;
            DisplayNameBox.Text = settings["displayName"] as string ?? string.Empty;

            var token = settings["token"] as string;
            if (!string.IsNullOrWhiteSpace(ServerBox.Text) && !string.IsNullOrWhiteSpace(token))
            {
                try
                {
                    _api.Configure(ServerBox.Text, token);
                    _me = await _api.GetMeAsync();
                    await EnterChatAsync();
                }
                catch
                {
                    settings.Remove("token");
                }
            }
        }

        private void HomeChatWidget_Unloaded(object sender, RoutedEventArgs e)
        {
            _pollTimer.Stop();
        }

        private async void LoginButton_Click(object sender, RoutedEventArgs e)
        {
            LoginButton.IsEnabled = false;
            LoginError.Text = string.Empty;
            try
            {
                var login = await _api.LoginAsync(ServerBox.Text, DisplayNameBox.Text, PasswordBox.Password);
                _me = login.User;
                var settings = ApplicationData.Current.LocalSettings.Values;
                settings["serverUrl"] = _api.BaseUrl;
                settings["displayName"] = _me.DisplayName;
                settings["token"] = login.Token;
                PasswordBox.Password = string.Empty;
                await EnterChatAsync();
            }
            catch (Exception ex)
            {
                LoginError.Text = FriendlyError(ex);
            }
            finally
            {
                LoginButton.IsEnabled = true;
            }
        }

        private async Task EnterChatAsync()
        {
            LoginView.Visibility = Visibility.Collapsed;
            ChatView.Visibility = Visibility.Visible;
            IdentityText.Text = _me.DisplayName + " · " + _me.Hid;
            await RefreshConversationsAsync(true);
            _pollTimer.Start();
        }

        private void LogoutButton_Click(object sender, RoutedEventArgs e)
        {
            _pollTimer.Stop();
            ApplicationData.Current.LocalSettings.Values.Remove("token");
            _messages.Clear();
            _conversations.Clear();
            _selected = null;
            _me = null;
            ChatView.Visibility = Visibility.Collapsed;
            LoginView.Visibility = Visibility.Visible;
            LoginError.Text = string.Empty;
        }

        private async void PollTimer_Tick(object sender, object e)
        {
            if (_refreshing) return;
            _refreshing = true;
            try
            {
                if (_selected != null)
                    await RefreshMessagesAsync(false);

                _conversationPollCounter++;
                if (_conversationPollCounter >= 2)
                {
                    _conversationPollCounter = 0;
                    await RefreshConversationsAsync(false);
                }
            }
            catch (Exception ex)
            {
                StatusText.Text = FriendlyError(ex);
            }
            finally
            {
                _refreshing = false;
            }
        }

        private async Task RefreshConversationsAsync(bool selectFirst)
        {
            var list = await _api.GetConversationsAsync();
            var selectedId = _selected?.Id;

            _conversations.Clear();
            foreach (var conversation in list)
            {
                conversation.Name = conversation.DisplayNameFor(_me.Id);
                _conversations.Add(conversation);
            }

            if (selectedId.HasValue)
            {
                var restored = _conversations.FirstOrDefault(c => c.Id == selectedId.Value);
                if (restored != null)
                {
                    _selected = restored;
                    ConversationList.SelectedItem = restored;
                }
            }
            else if (selectFirst && _conversations.Count > 0)
            {
                ConversationList.SelectedIndex = 0;
            }

            StatusText.Text = "Connected · " + DateTime.Now.ToString("h:mm:ss tt");
        }

        private async void ConversationList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _selected = ConversationList.SelectedItem as Conversation;
            if (_selected == null)
            {
                ConversationTitle.Text = "Choose a conversation";
                ComposerBox.IsEnabled = false;
                SendButton.IsEnabled = false;
                return;
            }

            ConversationTitle.Text = _selected.Name;
            ComposerBox.IsEnabled = true;
            SendButton.IsEnabled = true;
            await RefreshMessagesAsync(true);
        }

        private async Task RefreshMessagesAsync(bool forceScroll)
        {
            if (_selected == null) return;
            var list = await _api.GetMessagesAsync(_selected.Id);
            var lastId = _messages.Count > 0 ? _messages[_messages.Count - 1].Id : 0;
            var newLastId = list.Count > 0 ? list[list.Count - 1].Id : 0;

            if (!forceScroll && lastId == newLastId && _messages.Count == list.Count)
                return;

            _messages.Clear();
            foreach (var message in list)
                _messages.Add(message);

            if (_messages.Count > 0)
                MessageList.ScrollIntoView(_messages[_messages.Count - 1]);
        }

        private async void SendButton_Click(object sender, RoutedEventArgs e)
        {
            await SendCurrentMessageAsync();
        }

        private async void ComposerBox_KeyDown(object sender, KeyRoutedEventArgs e)
        {
            if (e.Key == VirtualKey.Enter)
            {
                e.Handled = true;
                await SendCurrentMessageAsync();
            }
        }

        private async Task SendCurrentMessageAsync()
        {
            if (_selected == null) return;
            var body = ComposerBox.Text?.Trim();
            if (string.IsNullOrWhiteSpace(body)) return;

            SendButton.IsEnabled = false;
            ComposerBox.IsEnabled = false;
            try
            {
                await _api.SendMessageAsync(_selected.Id, body);
                ComposerBox.Text = string.Empty;
                await RefreshMessagesAsync(true);
                await RefreshConversationsAsync(false);
            }
            catch (Exception ex)
            {
                StatusText.Text = FriendlyError(ex);
            }
            finally
            {
                ComposerBox.IsEnabled = true;
                SendButton.IsEnabled = true;
                ComposerBox.Focus(FocusState.Programmatic);
            }
        }

        private static string FriendlyError(Exception ex)
        {
            var text = ex.Message ?? "HomeChat request failed.";
            if (text.IndexOf("certificate", StringComparison.OrdinalIgnoreCase) >= 0)
                return "TLS certificate is not trusted. Install the HomeChat root certificate in Windows.";
            if (text.IndexOf("401", StringComparison.OrdinalIgnoreCase) >= 0)
                return "Session expired. Sign in again.";
            return text;
        }
    }
}
